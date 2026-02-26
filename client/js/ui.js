// ─── UI Module ─────────────────────────────────────────────────────────────────
// SPA router, DOM rendering, event wiring, and state management.

import { registerUser, loginUser, logoutUser, onAuthStateChanged } from './auth.js';
import { searchCards, getConversionRate } from './api.js';
import {
  createDeck, getUserDecks, getDeck, deleteDeck,
  addCardToDeck, removeCardFromDeck, updateCardQuantity,
  getDeckCards, calculateDeckSummary, ensureUserDocument
} from './decks.js';

// ─── State ─────────────────────────────────────────────────────────────────────
let currentUser = null;
let clpRate = 900;
let currentDecks = [];
let pendingCard = null; // card to add to a deck after selecting

// ─── DOM Refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ─── Init ──────────────────────────────────────────────────────────────────────
export async function init() {
  const { usdToClp } = await getConversionRate();
  clpRate = usdToClp;

  // Auth state listener
  onAuthStateChanged(user => {
    currentUser = user;
    updateAuthUI(user);
    if (user) {
      ensureUserDocument(user.uid, user.email).catch(console.error);
    }
  });

  // Bind all events
  bindEvents();

  // Load initial page from hash
  handleRoute(location.hash || '#search');
}

// ─── Router ────────────────────────────────────────────────────────────────────
function handleRoute(hash) {
  const [route, param] = hash.split('/');
  switch (route) {
    case '#search':
    case '':
      showPage('page-home');
      setNavActive('nav-search');
      break;
    case '#decks':
      if (!currentUser) { showToast('Inicia sesión para ver tus barajas', 'warning'); showPage('page-home'); break; }
      showPage('page-decks');
      setNavActive('nav-decks');
      loadDecksPage();
      break;
    case '#deck':
      if (!currentUser) { showToast('Inicia sesión para ver esta baraja', 'warning'); showPage('page-home'); break; }
      showPage('page-deck-detail');
      loadDeckDetailPage(param);
      break;
    default:
      showPage('page-home');
  }
}

window.addEventListener('hashchange', () => handleRoute(location.hash));

// ─── Page Visibility ───────────────────────────────────────────────────────────
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = $(pageId);
  if (page) page.classList.add('active');
}

function setNavActive(navId) {
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const link = $(navId);
  if (link) link.classList.add('active');
}

// ─── Auth UI ───────────────────────────────────────────────────────────────────
function updateAuthUI(user) {
  const guestActions = $('guest-actions');
  const userActions = $('user-actions');
  const userEmail = $('user-email-display');
  const navDecks = $('nav-decks');

  if (user) {
    if (guestActions) guestActions.style.display = 'none';
    if (userActions) userActions.style.display = 'flex';
    if (userEmail) userEmail.textContent = user.email;
    if (navDecks) navDecks.style.display = 'flex';
  } else {
    if (guestActions) guestActions.style.display = 'flex';
    if (userActions) userActions.style.display = 'none';
    if (navDecks) navDecks.style.display = 'none';
    // If on auth-required page, redirect
    if (location.hash.startsWith('#decks') || location.hash.startsWith('#deck')) {
      location.hash = '#search';
    }
  }
}

// ─── Event Binding ─────────────────────────────────────────────────────────────
function bindEvents() {
  // Navbar search
  const navInput = $('nav-search-input');
  const navSearchBtn = $('nav-search-btn');
  if (navInput) {
    navInput.addEventListener('keydown', e => { if (e.key === 'Enter') triggerSearch(navInput.value); });
  }
  if (navSearchBtn) navSearchBtn.addEventListener('click', () => triggerSearch(navInput?.value));

  // Hero search
  const heroInput = $('hero-search-input');
  const heroSearchBtn = $('hero-search-btn');
  if (heroInput) {
    heroInput.addEventListener('keydown', e => { if (e.key === 'Enter') triggerSearch(heroInput.value); });
  }
  if (heroSearchBtn) heroSearchBtn.addEventListener('click', () => triggerSearch(heroInput?.value));

  // Auth modal
  $('btn-login')?.addEventListener('click', () => openAuthModal('login'));
  $('btn-register')?.addEventListener('click', () => openAuthModal('register'));
  $('modal-tab-login')?.addEventListener('click', () => switchAuthTab('login'));
  $('modal-tab-register')?.addEventListener('click', () => switchAuthTab('register'));
  $('auth-modal-close')?.addEventListener('click', closeAuthModal);
  $('auth-modal-overlay')?.addEventListener('click', e => { if (e.target === $('auth-modal-overlay')) closeAuthModal(); });

  // Login form
  $('login-form')?.addEventListener('submit', handleLogin);
  // Register form
  $('register-form')?.addEventListener('submit', handleRegister);

  // User menu (avatar button)
  $('user-avatar-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    $('user-dropdown')?.classList.toggle('open');
  });
  document.addEventListener('click', () => $('user-dropdown')?.classList.remove('open'));

  // Logout
  $('btn-logout')?.addEventListener('click', handleLogout);

  // Nav - Decks
  $('nav-decks')?.addEventListener('click', () => { location.hash = '#decks'; });

  // Nav - Search
  $('nav-search')?.addEventListener('click', () => { location.hash = '#search'; });

  // Create deck button
  $('btn-create-deck')?.addEventListener('click', () => openDeckModal());
  $('deck-modal-close')?.addEventListener('click', closeDeckModal);
  $('deck-modal-overlay')?.addEventListener('click', e => { if (e.target === $('deck-modal-overlay')) closeDeckModal(); });
  $('deck-form')?.addEventListener('submit', handleCreateDeck);

  // Card detail modal
  $('card-modal-close')?.addEventListener('click', closeCardModal);
  $('card-modal-overlay')?.addEventListener('click', e => { if (e.target === $('card-modal-overlay')) closeCardModal(); });

  // Deck selector modal
  $('deck-selector-close')?.addEventListener('click', closeDeckSelector);
  $('deck-selector-overlay')?.addEventListener('click', e => { if (e.target === $('deck-selector-overlay')) closeDeckSelector(); });

  // Back from deck detail
  $('btn-back-decks')?.addEventListener('click', () => { location.hash = '#decks'; });
}

// ─── Search ────────────────────────────────────────────────────────────────────
async function triggerSearch(query) {
  if (!query || !query.trim()) return;
  location.hash = '#search';
  showPage('page-search-results');
  setNavActive('nav-search');
  $('nav-search-input').value = query;
  renderSearchSkeleton(query);

  try {
    const data = await searchCards(query);
    renderSearchResults(data.results || [], query, data.total || 0);
  } catch (err) {
    renderSearchError(err.message);
  }
}

function renderSearchSkeleton(query) {
  const container = $('search-results-grid');
  if (!container) return;
  $('search-results-section').style.display = 'block';
  $('page-home').classList.remove('active');
  $('page-search-results').classList.add('active');

  let html = '<div class="skeleton-grid">';
  for (let i = 0; i < 8; i++) {
    html += `<div class="skeleton-card">
      <div class="skeleton sk-img"></div>
      <div class="skeleton sk-title"></div>
      <div class="skeleton sk-meta"></div>
      <div class="skeleton sk-price"></div>
      <div class="skeleton sk-btn"></div>
    </div>`;
  }
  html += '</div>';
  container.innerHTML = html;
  $('search-results-header').innerHTML = `<span class="section-title">🔍 Buscando <em>"${escHtml(query)}"</em>...</span>`;
}

function renderSearchResults(cards, query, total) {
  const container = $('search-results-grid');
  const header = $('search-results-header');
  if (!container) return;

  header.innerHTML = `
    <span class="section-title">🔍 Resultados para <em>"${escHtml(query)}"</em></span>
    <span class="results-count">${total} carta${total !== 1 ? 's' : ''}</span>
  `;

  if (!cards.length) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-icon">🔍</div>
        <div class="empty-title">Sin resultados</div>
        <div class="empty-desc">No encontramos cartas para "<strong>${escHtml(query)}</strong>". Prueba con otro nombre o número.</div>
      </div>`;
    return;
  }

  container.innerHTML = cards.map(card => renderCardHTML(card)).join('');

  // Bind card actions
  container.querySelectorAll('[data-action="add-to-deck"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const card = JSON.parse(btn.dataset.card);
      handleAddToDeck(card);
    });
  });
}

function renderSearchError(message) {
  const container = $('search-results-grid');
  const header = $('search-results-header');
  if (container) container.innerHTML = `
    <div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon">⚠️</div>
      <div class="empty-title">Error al buscar</div>
      <div class="empty-desc">${escHtml(message)}</div>
    </div>`;
  if (header) header.innerHTML = `<span class="section-title">🔍 Error en búsqueda</span>`;
}

// ─── Card HTML ─────────────────────────────────────────────────────────────────
function renderCardHTML(card) {
  const priceStr = card.avgPrice != null ? `$${card.avgPrice.toFixed(2)}` : '—';
  const highStr = card.highPrice != null ? `$${card.highPrice.toFixed(2)}` : '—';
  const lowStr = card.lowPrice != null ? `$${card.lowPrice.toFixed(2)}` : '—';
  const clpStr = card.avgPrice != null ? `≈ CLP $${Math.round(card.avgPrice * clpRate).toLocaleString('es-CL')}` : '';
  const lastUpdated = card.lastUpdated ? new Date(card.lastUpdated).toLocaleDateString('es-CL') : '—';
  const imgHtml = card.image
    ? `<img src="${escHtml(card.image)}" alt="${escHtml(card.name)}" loading="lazy" onerror="this.parentElement.innerHTML='<span class=\\'card-no-image\\'>🃏</span>'">`
    : `<span class="card-no-image">🃏</span>`;

  const rarityClass = getRarityClass(card.rarity);
  const cardData = escHtml(JSON.stringify(card));

  const addBtn = currentUser
    ? `<button class="btn btn-secondary btn-sm" data-action="add-to-deck" data-card='${JSON.stringify(card).replace(/'/g, "&#39;")}'>＋ Baraja</button>`
    : `<button class="btn btn-outline btn-sm" onclick="window.__openAuth('login')" title="Inicia sesión para guardar">🔒 Guardar</button>`;

  return `
    <div class="pokemon-card">
      <div class="card-image-wrap">
        ${imgHtml}
        ${card.rarity ? `<span class="card-rarity-badge ${rarityClass}">${escHtml(card.rarity)}</span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-name" title="${escHtml(card.name)}">${escHtml(card.name)}</div>
        <div class="card-meta">
          <span>${escHtml(card.set)}</span>
          ${card.number ? `<span class="separator">·</span><span>#${escHtml(String(card.number))}</span>` : ''}
        </div>
        <div class="card-prices">
          <div class="price-row">
            <span class="price-label">Precio promedio</span>
            <span class="price-value price-avg ${card.avgPrice == null ? 'price-null' : ''}">${priceStr}</span>
          </div>
          ${clpStr ? `<div class="price-row"><span class="price-label"></span><span class="price-clp">${clpStr}</span></div>` : ''}
          <div class="price-row">
            <span class="price-label">Alto / Bajo</span>
            <span class="price-value"><span class="price-high">${highStr}</span> / <span class="price-low">${lowStr}</span></span>
          </div>
          <div class="price-row">
            <span class="price-label">Actualizado</span>
            <span class="price-value" style="font-size:11px;color:var(--text-muted)">${lastUpdated}</span>
          </div>
        </div>
        <div class="card-actions">
          ${addBtn}
        </div>
      </div>
    </div>`;
}

function getRarityClass(rarity) {
  if (!rarity) return '';
  const r = rarity.toLowerCase();
  if (r.includes('ultra') || r.includes('secret')) return 'rarity-ultra';
  if (r.includes('holo') || r.includes('reverse')) return 'rarity-holo';
  if (r.includes('rare')) return 'rarity-rare';
  return '';
}

// ─── Auth ──────────────────────────────────────────────────────────────────────
function openAuthModal(tab = 'login') {
  switchAuthTab(tab);
  $('auth-modal-overlay').classList.add('open');
}
function closeAuthModal() { $('auth-modal-overlay').classList.remove('open'); }

function switchAuthTab(tab) {
  $('modal-tab-login').classList.toggle('active', tab === 'login');
  $('modal-tab-register').classList.toggle('active', tab === 'register');
  $('login-panel').style.display = tab === 'login' ? 'block' : 'none';
  $('register-panel').style.display = tab === 'register' ? 'block' : 'none';
}

// Expose for inline onclick
window.__openAuth = openAuthModal;

async function handleLogin(e) {
  e.preventDefault();
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  const errEl = $('login-error');
  errEl.classList.remove('show');

  if (!email || !password) { errEl.textContent = 'Completa todos los campos.'; errEl.classList.add('show'); return; }

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span> Ingresando...';

  try {
    await loginUser(email, password);
    closeAuthModal();
    showToast('¡Bienvenido de vuelta! 👋', 'success');
    e.target.reset();
  } catch (err) {
    const msg = parseFirebaseError(err.code);
    errEl.textContent = msg;
    errEl.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Iniciar sesión';
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const email = $('register-email').value.trim();
  const password = $('register-password').value;
  const errEl = $('register-error');
  errEl.classList.remove('show');

  if (!email || !password) { errEl.textContent = 'Completa todos los campos.'; errEl.classList.add('show'); return; }
  if (password.length < 6) { errEl.textContent = 'La contraseña debe tener al menos 6 caracteres.'; errEl.classList.add('show'); return; }

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span> Registrando...';

  try {
    await registerUser(email, password);
    closeAuthModal();
    showToast('¡Cuenta creada exitosamente! 🎉', 'success');
    e.target.reset();
  } catch (err) {
    const msg = parseFirebaseError(err.code);
    errEl.textContent = msg;
    errEl.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Crear cuenta';
  }
}

async function handleLogout() {
  await logoutUser();
  location.hash = '#search';
  showToast('Sesión cerrada', 'info');
}

function parseFirebaseError(code) {
  const map = {
    'auth/user-not-found': 'Usuario no encontrado.',
    'auth/wrong-password': 'Contraseña incorrecta.',
    'auth/invalid-credential': 'Credenciales inválidas.',
    'auth/email-already-in-use': 'El email ya está en uso.',
    'auth/weak-password': 'La contraseña es muy débil.',
    'auth/invalid-email': 'Email inválido.',
    'auth/too-many-requests': 'Demasiados intentos. Intenta más tarde.',
    'auth/network-request-failed': 'Error de conexión. Verifica tu internet.',
  };
  return map[code] || 'Ocurrió un error. Inténtalo de nuevo.';
}

// ─── Decks Page ────────────────────────────────────────────────────────────────
async function loadDecksPage() {
  const container = $('decks-grid');
  if (!container) return;
  container.innerHTML = `<div class="empty-state"><div class="loading-spinner" style="width:32px;height:32px;margin:0 auto"></div></div>`;

  try {
    currentDecks = await getUserDecks(currentUser.uid);
    renderDecksGrid(currentDecks);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Error cargando barajas</div><div class="empty-desc">${escHtml(err.message)}</div></div>`;
  }
}

function renderDecksGrid(decks) {
  const container = $('decks-grid');
  const counter = $('deck-count');
  if (counter) counter.textContent = decks.length;

  if (!decks.length) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-icon">📦</div>
        <div class="empty-title">Sin barajas</div>
        <div class="empty-desc">Crea tu primera baraja para empezar a organizar tu colección Pokémon.</div>
        <button class="btn btn-primary" onclick="document.getElementById('btn-create-deck').click()">＋ Crear baraja</button>
      </div>`;
    return;
  }

  container.innerHTML = decks.map(deck => `
    <div class="deck-card" data-deck-id="${deck.id}">
      <div class="deck-card-header">
        <div class="deck-card-icon">📦</div>
        <div>
          <div class="deck-card-title">${escHtml(deck.nombre)}</div>
          ${deck.descripcion ? `<div class="deck-card-desc">${escHtml(deck.descripcion)}</div>` : ''}
        </div>
      </div>
      <div class="deck-stats">
        <div class="deck-stat">
          <div class="ds-value" id="deck-stat-${deck.id}">—</div>
          <div class="ds-label">Valor USD</div>
        </div>
        <div class="deck-stat">
          <div class="ds-value" id="deck-cards-${deck.id}">—</div>
          <div class="ds-label">Cartas</div>
        </div>
      </div>
      <div class="deck-card-footer">
        <button class="btn btn-primary btn-sm" onclick="location.hash='#deck/${deck.id}'">Ver baraja</button>
        <button class="btn btn-danger btn-sm" data-action="delete-deck" data-deck-id="${deck.id}">🗑️</button>
      </div>
    </div>`).join('');

  // Load stats for each deck asynchronously
  decks.forEach(deck => loadDeckStats(deck.id));

  // Bind delete
  container.querySelectorAll('[data-action="delete-deck"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      handleDeleteDeck(btn.dataset.deckId);
    });
  });
}

async function loadDeckStats(deckId) {
  try {
    const cards = await getDeckCards(currentUser.uid, deckId);
    const summary = calculateDeckSummary(cards);
    const valEl = $(`deck-stat-${deckId}`);
    const cntEl = $(`deck-cards-${deckId}`);
    if (valEl) valEl.textContent = `$${summary.total.toFixed(2)}`;
    if (cntEl) cntEl.textContent = summary.cardCount;
  } catch { /* silently fail */ }
}

// ─── Deck Detail ───────────────────────────────────────────────────────────────
async function loadDeckDetailPage(deckId) {
  const container = $('deck-detail-content');
  if (!container || !deckId) return;
  container.innerHTML = `<div class="empty-state"><div class="loading-spinner" style="width:32px;height:32px;margin:0 auto"></div></div>`;

  try {
    const [deck, cards] = await Promise.all([
      getDeck(currentUser.uid, deckId),
      getDeckCards(currentUser.uid, deckId)
    ]);
    renderDeckDetail(deck, cards, deckId);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Error</div><div class="empty-desc">${escHtml(err.message)}</div></div>`;
  }
}

function renderDeckDetail(deck, cards, deckId) {
  const summary = calculateDeckSummary(cards);
  const container = $('deck-detail-content');

  const createdDate = deck.createdAt?.toDate
    ? deck.createdAt.toDate().toLocaleDateString('es-CL')
    : '—';

  const mostExpensive = summary.mostExpensive;

  container.innerHTML = `
    <div class="deck-detail-header">
      <div class="deck-detail-icon-big">📦</div>
      <div class="deck-detail-info">
        <div class="deck-detail-name">${escHtml(deck.nombre)}</div>
        ${deck.descripcion ? `<div class="deck-detail-desc">${escHtml(deck.descripcion)}</div>` : ''}
        <div class="deck-detail-date">Creada el ${createdDate}</div>
      </div>
      <div class="deck-detail-actions">
        <button class="btn btn-danger btn-sm" id="btn-delete-this-deck" data-deck-id="${deckId}">🗑️ Eliminar baraja</button>
      </div>
    </div>

    <div class="summary-grid">
      <div class="summary-card highlight">
        <div class="summary-icon si-blue">💰</div>
        <div class="summary-content">
          <div class="summary-label">Valor total</div>
          <div class="summary-value">$${summary.total.toFixed(2)}</div>
          <div class="summary-sub">≈ CLP $${Math.round(summary.total * clpRate).toLocaleString('es-CL')}</div>
        </div>
      </div>
      <div class="summary-card">
        <div class="summary-icon si-green">🃏</div>
        <div class="summary-content">
          <div class="summary-label">Total cartas</div>
          <div class="summary-value">${summary.cardCount}</div>
          <div class="summary-sub">${summary.uniqueCards} tipo${summary.uniqueCards !== 1 ? 's' : ''} únicos</div>
        </div>
      </div>
      <div class="summary-card">
        <div class="summary-icon si-gold">⭐</div>
        <div class="summary-content">
          <div class="summary-label">Carta más cara</div>
          <div class="summary-value">${mostExpensive ? `$${parseFloat(mostExpensive.precioUnitario).toFixed(2)}` : '—'}</div>
          <div class="summary-sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px">${mostExpensive ? escHtml(mostExpensive.nombre) : 'Sin cartas'}</div>
        </div>
      </div>
    </div>

    <div class="section-header">
      <span class="section-title">🃏 Cartas en la baraja</span>
      <button class="btn btn-outline btn-sm" id="btn-search-to-add">＋ Buscar y agregar carta</button>
    </div>

    <div id="deck-cards-container">
      ${renderCardsTable(cards, deckId)}
    </div>
  `;

  // Bind delete deck button
  $('btn-delete-this-deck')?.addEventListener('click', () => handleDeleteDeck(deckId, true));

  // Bind search to add
  $('btn-search-to-add')?.addEventListener('click', () => {
    location.hash = '#search';
    showToast('Busca una carta y usa el botón "＋ Baraja" para agregarla', 'info');
  });

  // Bind card table actions
  bindTableActions(cards, deckId);
}

function renderCardsTable(cards, deckId) {
  if (!cards.length) {
    return `<div class="empty-state">
      <div class="empty-icon">🃏</div>
      <div class="empty-title">Sin cartas</div>
      <div class="empty-desc">Usa la búsqueda para encontrar cartas y agregarlas a esta baraja.</div>
    </div>`;
  }

  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Carta</th>
            <th>Set / #</th>
            <th>Precio guardado</th>
            <th>Cantidad</th>
            <th>Subtotal</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${cards.map(card => renderCardRow(card, deckId)).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderCardRow(card, deckId) {
  const price = parseFloat(card.precioUnitario) || 0;
  const qty = parseInt(card.cantidad) || 1;
  const subtotal = price * qty;
  const fechaAgregada = card.fechaAgregada?.toDate
    ? card.fechaAgregada.toDate().toLocaleDateString('es-CL')
    : '—';

  return `
    <tr data-card-id="${card.id}">
      <td>
        <div style="display:flex;align-items:center;gap:12px">
          ${card.imagen ? `<img src="${escHtml(card.imagen)}" alt="${escHtml(card.nombre)}" class="table-card-img" onerror="this.style.display='none'">` : '<span style="font-size:24px">🃏</span>'}
          <div>
            <div class="table-card-name">${escHtml(card.nombre)}</div>
            <div style="font-size:10px;color:var(--text-muted)">Agregada: ${fechaAgregada}</div>
          </div>
        </div>
      </td>
      <td>
        <div class="table-card-set">${escHtml(card.set)}</div>
        ${card.numero ? `<div style="font-size:11px;color:var(--text-faint)">#${escHtml(String(card.numero))}</div>` : ''}
      </td>
      <td>
        <div style="font-weight:700;color:var(--primary)">${price > 0 ? `$${price.toFixed(2)}` : '—'}</div>
        ${price > 0 ? `<div class="price-clp">≈ CLP $${Math.round(price * clpRate).toLocaleString('es-CL')}</div>` : ''}
      </td>
      <td>
        <div class="qty-control">
          <button class="qty-btn" data-action="qty-dec" data-deck-id="${deckId}" data-card-id="${card.id}" data-qty="${qty}">−</button>
          <span class="qty-value">${qty}</span>
          <button class="qty-btn" data-action="qty-inc" data-deck-id="${deckId}" data-card-id="${card.id}" data-qty="${qty}">＋</button>
        </div>
      </td>
      <td style="font-weight:700">${subtotal > 0 ? `$${subtotal.toFixed(2)}` : '—'}</td>
      <td>
        <button class="btn btn-danger btn-sm" data-action="remove-card" data-deck-id="${deckId}" data-card-id="${card.id}">🗑️</button>
      </td>
    </tr>`;
}

function bindTableActions(initialCards, deckId) {
  const container = $('deck-cards-container');
  if (!container) return;

  container.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const cardId = btn.dataset.cardId;
    const deckIdFromBtn = btn.dataset.deckId || deckId;
    const currentQty = parseInt(btn.dataset.qty) || 1;

    if (action === 'remove-card') {
      btn.disabled = true;
      try {
        await removeCardFromDeck(currentUser.uid, deckIdFromBtn, cardId);
        showToast('Carta eliminada', 'success');
        await refreshDeckDetail(deckIdFromBtn);
      } catch (err) {
        showToast('Error al eliminar carta: ' + err.message, 'error');
        btn.disabled = false;
      }
    }

    if (action === 'qty-inc') {
      try {
        await updateCardQuantity(currentUser.uid, deckIdFromBtn, cardId, currentQty + 1);
        await refreshDeckDetail(deckIdFromBtn);
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    }

    if (action === 'qty-dec') {
      try {
        if (currentQty <= 1) {
          if (!confirm('¿Eliminar esta carta de la baraja?')) return;
        }
        await updateCardQuantity(currentUser.uid, deckIdFromBtn, cardId, currentQty - 1);
        await refreshDeckDetail(deckIdFromBtn);
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    }
  });
}

async function refreshDeckDetail(deckId) {
  try {
    const [deck, cards] = await Promise.all([
      getDeck(currentUser.uid, deckId),
      getDeckCards(currentUser.uid, deckId)
    ]);
    renderDeckDetail(deck, cards, deckId);
  } catch (err) {
    console.error('Error refreshing deck detail:', err);
  }
}

// ─── Deck CRUD Actions ─────────────────────────────────────────────────────────
function openDeckModal() {
  $('deck-form')?.reset();
  $('deck-modal-overlay').classList.add('open');
  $('deck-nombre').focus();
}
function closeDeckModal() { $('deck-modal-overlay').classList.remove('open'); }

async function handleCreateDeck(e) {
  e.preventDefault();
  const nombre = $('deck-nombre').value.trim();
  const descripcion = $('deck-descripcion').value.trim();
  if (!nombre) { showToast('El nombre de la baraja es obligatorio', 'warning'); return; }

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span> Creando...';

  try {
    await createDeck(currentUser.uid, { nombre, descripcion });
    closeDeckModal();
    showToast(`Baraja "${nombre}" creada`, 'success');
    await loadDecksPage();
  } catch (err) {
    showToast('Error al crear baraja: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '＋ Crear baraja';
  }
}

async function handleDeleteDeck(deckId, redirect = false) {
  if (!confirm('¿Estás seguro de eliminar esta baraja y todas sus cartas?')) return;
  try {
    await deleteDeck(currentUser.uid, deckId);
    showToast('Baraja eliminada', 'success');
    if (redirect) {
      location.hash = '#decks';
    } else {
      await loadDecksPage();
    }
  } catch (err) {
    showToast('Error al eliminar: ' + err.message, 'error');
  }
}

// ─── Add to Deck Flow ──────────────────────────────────────────────────────────
async function handleAddToDeck(card) {
  if (!currentUser) { openAuthModal('login'); return; }

  pendingCard = card;

  try {
    currentDecks = await getUserDecks(currentUser.uid);
  } catch (err) {
    showToast('Error cargando barajas: ' + err.message, 'error');
    return;
  }

  if (currentDecks.length === 0) {
    showToast('Primero crea una baraja desde la sección "Mis Barajas"', 'warning');
    return;
  }

  renderDeckSelector(currentDecks);
  $('deck-selector-overlay').classList.add('open');
}

function renderDeckSelector(decks) {
  const list = $('deck-selector-list');
  list.innerHTML = decks.map(deck => `
    <button class="deck-selector-item" data-deck-id="${deck.id}">
      <span style="font-size:24px">📦</span>
      <div>
        <div class="dsi-name">${escHtml(deck.nombre)}</div>
        <div class="dsi-count">Baraja de cartas</div>
      </div>
    </button>`).join('');

  list.querySelectorAll('.deck-selector-item').forEach(item => {
    item.addEventListener('click', () => confirmAddCard(item.dataset.deckId));
  });
}

function closeDeckSelector() {
  $('deck-selector-overlay').classList.remove('open');
  pendingCard = null;
}

async function confirmAddCard(deckId) {
  if (!pendingCard) return;
  const deck = currentDecks.find(d => d.id === deckId);

  const cardData = {
    cardIdAPI: pendingCard.id,
    nombre: pendingCard.name,
    set: pendingCard.set,
    numero: pendingCard.number || null,
    imagen: pendingCard.image || null,
    precioUnitario: pendingCard.avgPrice || 0
  };

  closeDeckSelector();

  try {
    await addCardToDeck(currentUser.uid, deckId, cardData);
    showToast(`"${pendingCard.name}" agregada a "${deck?.nombre}"`, 'success');
  } catch (err) {
    showToast('Error al agregar carta: ' + err.message, 'error');
  }
  pendingCard = null;
}

// ─── Card Detail Modal (optional) ──────────────────────────────────────────────
function closeCardModal() { $('card-modal-overlay').classList.remove('open'); }

// ─── Toasts ────────────────────────────────────────────────────────────────────
export function showToast(message, type = 'info') {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span class="toast-msg">${escHtml(message)}</span>`;
  $('toast-container').appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, 4000);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
