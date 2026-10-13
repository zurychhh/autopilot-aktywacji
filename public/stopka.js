// Wspólna stopka dla wszystkich stron.
//
// Jeden plik z danymi, nie dziewięć kopii — inaczej dodanie modułu znaczy
// dziewięć edycji i gwarantowane rozjechanie się list.
//
// Strona wstawia stopkę sama: `<script type="module" src="/stopka.js"></script>`
// i nic więcej. Skrypt podmienia istniejący `<footer>`, a gdy go nie ma,
// dokłada własny na końcu `.wrap`.

export const MODULY = [
  { adres: '/', nazwa: 'Pętla aktywacji' },
  { adres: '/kokpit', nazwa: 'Kokpit' },
  { adres: '/mapa', nazwa: 'Mapa bez aplikacji' },
  { adres: '/operator/Play', nazwa: 'Brief dla operatora' },
  { adres: '/autopilot', nazwa: 'Autopilot testów' },
  { adres: '/rozpoznanie', nazwa: 'Rozpoznanie numeru' },
  { adres: '/prywatnosc.html', nazwa: 'Co zapisujemy' }
];

export const AUTOR = {
  imie: 'Rafał Oleksiak',
  adres: 'https://oleksiakconsulting.com',
  etykieta: 'oleksiakconsulting.com'
};

const STYL = `
.stopka{margin-top:36px;padding-top:18px;border-top:1px solid var(--line,#e4e4ec);
  display:grid;gap:10px;font-size:.84rem;color:var(--muted,#6e6e85)}
.stopka nav{display:flex;flex-wrap:wrap;gap:6px 14px}
.stopka a{color:var(--brand-deep,#0303b0);text-decoration:none}
.stopka a:hover{text-decoration:underline}
.stopka a[aria-current]{color:var(--muted,#6e6e85);text-decoration:none;cursor:default}
.stopka .autor{color:var(--muted,#6e6e85)}
`;

/**
 * Czy odnośnik wskazuje stronę, na której właśnie jesteśmy.
 * Porównujemy po pierwszym członie ścieżki, żeby /mapa/KOD liczyło się jako
 * mapa, a /operator/Play jako brief operatora — to są widoki tego samego modułu.
 */
export function biezaca(adres, sciezka) {
  if (adres === '/') return sciezka === '/' || sciezka === '/index.html';
  const korzen = '/' + adres.split('/')[1];
  return sciezka === korzen || sciezka.startsWith(korzen + '/');
}

export function zbudujStopke(sciezka = location.pathname) {
  const linki = MODULY.map(m => {
    const tu = biezaca(m.adres, sciezka);
    return tu
      ? `<a href="${m.adres}" aria-current="page">${m.nazwa}</a>`
      : `<a href="${m.adres}">${m.nazwa}</a>`;
  }).join('');

  return `<nav aria-label="Moduły prototypu">${linki}</nav>
    <p class="autor">Autor: ${AUTOR.imie} · <a href="${AUTOR.adres}" target="_blank" rel="noopener">${AUTOR.etykieta}</a></p>`;
}

function wstaw() {
  if (!document.getElementById('styl-stopki')) {
    const st = document.createElement('style');
    st.id = 'styl-stopki';
    st.textContent = STYL;
    document.head.appendChild(st);
  }

  let stopka = document.querySelector('footer');
  if (!stopka) {
    stopka = document.createElement('footer');
    (document.querySelector('.wrap') || document.body).appendChild(stopka);
  }
  stopka.className = 'stopka';
  stopka.innerHTML = zbudujStopke();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wstaw);
  else wstaw();
}
