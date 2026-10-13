#!/usr/bin/env node
// Serwer MCP nad API User.com. Transport stdio — tak podłącza się go
// do Claude Code i Claude Desktop.
//
// Wszystkie narzędzia chodzą przez wspólnego klienta z lib/usercom.js,
// tego samego, którego używa backend. DRY_RUN jest domyślnie włączony:
// narzędzie, które domyślnie wysyła kampanie SMS, byłoby groźne.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { klientUserCom, BladUserCom } from '../lib/usercom.js';

const klient = klientUserCom();

/** Każde narzędzie zwraca JSON jako tekst; błędy jako czytelny komunikat. */
function odpowiedz(dane) {
  return { content: [{ type: 'text', text: JSON.stringify(dane, null, 2) }] };
}

function blad(e) {
  const tresc = e instanceof BladUserCom
    ? `Błąd User.com${e.status ? ` (${e.status})` : ''}: ${e.message}` +
      (e.tresc ? `\n${JSON.stringify(e.tresc, null, 2)}` : '')
    : `Błąd: ${e.message}`;
  return { content: [{ type: 'text', text: tresc }], isError: true };
}

const wykonaj = (fn) => async (args) => {
  try { return odpowiedz(await fn(args)); } catch (e) { return blad(e); }
};

const server = new McpServer({ name: 'usercom', version: '1.0.0' });

server.registerTool('list_segments', {
  title: 'Lista segmentów',
  description: 'Zwraca segmenty użytkowników z User.com razem z liczebnością. ' +
    'Od tego zaczyna się dobór odbiorców dla testu.',
  inputSchema: {}
}, wykonaj(() => klient.listSegments()));

server.registerTool('get_user', {
  title: 'Dane użytkownika',
  description: 'Jeden użytkownik po id, adresie e-mail albo numerze telefonu. ' +
    'Służy do sprawdzenia, czy osoba ma pakiet i czy pobrała aplikację.',
  inputSchema: {
    id: z.string().optional().describe('Identyfikator użytkownika w User.com'),
    email: z.string().optional().describe('Adres e-mail'),
    phone: z.string().optional().describe('Numer telefonu w formacie międzynarodowym')
  }
}, wykonaj((a) => klient.getUser(a)));

server.registerTool('create_event', {
  title: 'Zapisz zdarzenie',
  description: 'Zapisuje zdarzenie na koncie użytkownika — tak trafiają do User.com ' +
    'mikrokonwersje prototypu, na przykład pierwsze zobaczenie mapy.',
  inputSchema: {
    userId: z.string().describe('Identyfikator użytkownika'),
    nazwa: z.string().describe('Nazwa zdarzenia, na przykład pierwsza_lokalizacja'),
    dane: z.record(z.string(), z.unknown()).optional().describe('Dodatkowe pola zdarzenia')
  }
}, wykonaj((a) => klient.createEvent(a)));

server.registerTool('create_test_campaign', {
  title: 'Szkic kampanii SMS',
  description: 'Tworzy kampanię SMS jako SZKIC. Nie wysyła jej — wysyłkę uruchamia ' +
    'człowiek w panelu User.com. Treść dłuższa niż 160 znaków jest odrzucana.',
  inputSchema: {
    nazwa: z.string().describe('Nazwa kampanii widoczna w panelu'),
    tresc: z.string().describe('Treść SMS, maksymalnie 160 znaków, bez polskich znaków'),
    segmentId: z.number().optional().describe('Identyfikator segmentu odbiorców')
  }
}, wykonaj((a) => klient.createTestCampaign(a)));

server.registerTool('get_campaign_stats', {
  title: 'Statystyki kampanii',
  description: 'Wyniki kampanii SMS albo e-mail: wysłane, dostarczone, kliknięcia, wypisania. ' +
    'Tymi liczbami karmi się krok 5 prototypu.',
  inputSchema: {
    id: z.number().optional().describe('Identyfikator kampanii'),
    kanal: z.enum(['sms', 'email']).optional().describe('Kanał kampanii, domyślnie sms')
  }
}, wykonaj((a) => klient.getCampaignStats(a)));

const transport = new StdioServerTransport();
await server.connect(transport);
// Komunikat na stderr, bo stdout należy do protokołu MCP
console.error(`[usercom] serwer MCP gotowy, DRY_RUN=${klient.dryRun}`);
