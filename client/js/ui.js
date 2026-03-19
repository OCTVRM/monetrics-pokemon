// ─── UI Module ─────────────────────────────────────────────────────────────────
// SPA router, DOM rendering, event wiring, and state management.

import { registerUser, loginUser, logoutUser, onAuthStateChanged } from './auth.js';
import { searchCards, getConversionRate } from './api.js';
import {
  createDeck, getUserDecks, getDeck, deleteDeck,
  addCardToDeck, removeCardFromDeck, updateCardQuantity,
  getDeckCards, calculateDeckSummary, ensureUserDocument,
  syncDeckStats, subscribeToUserDecks, subscribeToDeck, subscribeToDeckCards,
  getUserProfile, updateUserProfile, getPublicProfile
} from './decks.js';
import {
  subscribeToMarketListings, createMarketListing,
  getMarketListing, getListingsBySameCard, deactivateMarketListing,
  searchListingsBySeller
} from './market.js';
import {
  getConversations, getOrCreateConversation, getMessages,
  sendMessage, subscribeToMessages, getConversationById, subscribeToNewConversations
} from './chat.js';
import { submitReview, getUserReviews } from './reviews.js';
import { store } from './store.js';

// ─── State ─────────────────────────────────────────────────────────────────────
let currentUser = null;
let clpRate = 900;
let currentDecks = null;
let pendingCard = null; // card to add to a deck after selecting
let authInitialized = false; // Prevents premature redirection on initial page load
let activeSubscriptions = {}; // Track Firebase onSnapshot listeners for cleanup
let allMarketListings = []; // Market state for client-side filtering
let allStoreProducts = [];   // Store state for product detail
let userProfilesCache = {}; // Cache for seller profiles to avoid redundant fetches

// ─── DOM Refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ─── Init ──────────────────────────────────────────────────────────────────────
export async function init() {
  // Don't block init on conversion rate
  getConversionRate().then(data => { clpRate = data.usdToClp; });

  // Listen to auth state changes.
  onAuthStateChanged(async user => {
    // Break potential loop: only proceed if user actually changed
    if (authInitialized && user?.id === currentUser?.id) return;

    console.log('Auth state changed:', user ? user.email : 'null');
    currentUser = user;

    if (user) {
      try {
        const profile = await getUserProfile(user.id);
        currentUser.role = profile?.role || 'user';
      } catch (err) {
        console.warn('Error fetching profile:', err);
      }
    }

    updateAuthUI(currentUser);

    // Initial routing on load
    if (!authInitialized) {
      authInitialized = true;
      handleRoute(location.hash || '#home');
    }
  });

  // Bind all events
  bindEvents();
}


// ─── Router ────────────────────────────────────────────────────────────────────
function clearSubscriptions() {
  Object.values(activeSubscriptions).forEach(unsub => {
    if (typeof unsub === 'function') unsub();
  });
  activeSubscriptions = {};
}

function handleRoute(hash) {
  const [route, param] = hash.split('/');
  clearSubscriptions();

  console.log('[Router] Routing to:', route, 'with param:', param);

  switch (route) {
    case '#home':
    case '':
      showPage('page-home');
      setNavActive('nav-logo'); // or nothing
      break;
    case '#search':
      showPage('page-search-results');
      setNavActive('nav-search');
      // If there is no query in the search input but we are on #search, 
      // maybe we should stay on home or show empty results.
      // Usually, triggerSearch handles this.
      break;
    case '#decks':
      if (!currentUser) {
        showToast('Inicia sesión para ver tus barajas', 'warning');
        location.hash = '#home';
        break;
      }
      showPage('page-decks');
      setNavActive('nav-decks');
      loadDecksPage();
      break;
    case '#deck':
      if (!currentUser) {
        showToast('Inicia sesión para ver esta baraja', 'warning');
        location.hash = '#home';
        break;
      }
      showPage('page-deck-detail');
      loadDeckDetailPage(param);
      break;
    case '#market':
      showPage('page-market');
      setNavActive('nav-market');
      loadMarketPage();
      break;
    case '#store':
      showPage('page-store');
      setNavActive('nav-store');
      loadStorePage();
      break;
    case '#profile':
      if (!currentUser) {
        showToast('Inicia sesión para ver tu perfil', 'warning');
        location.hash = '#home';
        break;
      }
      showPage('page-profile');
      loadProfilePage();
      break;
    case '#chat':
      if (!currentUser) {
        showToast('Inicia sesión para ver tus mensajes', 'warning');
        location.hash = '#home';
        break;
      }
      showPage('page-chat');
      loadChatPage(param);
      break;
    case '#user':
      showPage('page-user-profile');
      loadPublicProfilePage(param);
      break;
    default:
      console.warn('[Router] Unknown route:', route);
      location.hash = '#home';
  }
}


window.addEventListener('hashchange', () => handleRoute(location.hash));

// ─── Page Visibility ───────────────────────────────────────────────────────────
function showPage(pageId) {
  const pages = document.querySelectorAll('.page');
  pages.forEach(p => p.classList.remove('active'));

  const page = $(pageId);
  if (page) {
    page.classList.add('active');
    console.log('Showing page:', pageId);
  } else {
    console.error('Page not found:', pageId);
  }
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
  const userRole = $('user-role-display');
  const navDecks = $('nav-decks');
  const btnCartToggle = $('btn-cart-toggle');

  if (user) {
    if (guestActions) guestActions.style.display = 'none';
    if (userActions) userActions.style.display = 'flex';
    if (userEmail) userEmail.textContent = user.email;
    if (userRole) {
      if (user.role === 'admin') {
        userRole.innerHTML = 'Administrador <span class="admin-badge">Admin</span>';
        document.body.classList.add('user-role-admin');
      } else {
        userRole.textContent = 'Usuario registrado';
        document.body.classList.remove('user-role-admin');
      }
    }
    if (navDecks) navDecks.style.display = 'flex';
    const navChat = $('nav-chat');
    if (navChat) navChat.style.display = 'flex';
    if (btnCartToggle) {
      btnCartToggle.style.display = 'flex';
      updateCartBadge();
    }
    const btnSell = $('btn-sell-card');
    if (btnSell) btnSell.style.display = 'flex';
    const btnCreateProd = $('btn-create-product');
    if (btnCreateProd) btnCreateProd.style.display = user.role === 'admin' ? 'block' : 'none';
  } else {
    if (guestActions) guestActions.style.display = 'flex';
    if (userActions) userActions.style.display = 'none';
    if (navDecks) navDecks.style.display = 'none';
    const navChat = $('nav-chat');
    if (navChat) navChat.style.display = 'none';
    if (btnCartToggle) btnCartToggle.style.display = 'none';
    const btnSell = $('btn-sell-card');
    if (btnSell) btnSell.style.display = 'none';
    const btnCreateProd = $('btn-create-product');
    if (btnCreateProd) btnCreateProd.style.display = 'none';
    document.body.classList.remove('user-role-admin');

    if (authInitialized && (location.hash.startsWith('#decks') || location.hash.startsWith('#deck') || location.hash.startsWith('#profile'))) {
      location.hash = '#search';
    }
  }
}

function bindEvents() {
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

  // Nav - Search / Home
  $('nav-logo')?.addEventListener('click', () => { location.hash = '#home'; });
  $('nav-search')?.addEventListener('click', () => { location.hash = '#search'; });

  // Create deck button
  $('btn-create-deck')?.addEventListener('click', () => openDeckModal());
  $('deck-modal-close')?.addEventListener('click', closeDeckModal);
  $('deck-modal-cancel-btn')?.addEventListener('click', closeDeckModal);
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

  // Sell card modal
  $('btn-sell-card')?.addEventListener('click', openSellModal);
  $('sell-modal-close')?.addEventListener('click', closeSellModal);
  $('sell-modal-cancel')?.addEventListener('click', closeSellModal);
  $('sell-modal-overlay')?.addEventListener('click', e => { if (e.target === $('sell-modal-overlay')) closeSellModal(); });
  $('sell-form')?.addEventListener('submit', handleSubmitListing);

  // Sell form - price suggestion on name change
  $('sell-nombre')?.addEventListener('blur', fetchPriceSuggestion);
  $('sell-edicion')?.addEventListener('blur', fetchPriceSuggestion);

  // Listing detail modal
  $('listing-detail-close')?.addEventListener('click', closeListingDetail);
  $('listing-detail-overlay')?.addEventListener('click', e => { if (e.target === $('listing-detail-overlay')) closeListingDetail(); });

  // Market search
  const marketInput = $('market-search-input');
  const marketSellerInput = $('market-seller-search-input');
  const triggerMarketSearch = async () => {
    const q = marketInput?.value?.trim();
    const sq = marketSellerInput?.value?.trim();
    if (sq) {
      const results = await searchListingsBySeller(sq);
      renderMarketGrid(results);
    } else if (q) {
      filterMarket(q);
    } else {
      renderMarketGrid(allMarketListings);
    }
  };
  $('market-search-btn')?.addEventListener('click', triggerMarketSearch);
  marketInput?.addEventListener('keydown', e => { if (e.key === 'Enter') triggerMarketSearch(); });
  marketSellerInput?.addEventListener('keydown', e => { if (e.key === 'Enter') triggerMarketSearch(); });

  // Nav - Tienda
  $('nav-store')?.addEventListener('click', () => { location.hash = '#store'; });

  // Cart
  $('btn-cart-toggle')?.addEventListener('click', openCartModal);
  $('cart-modal-close')?.addEventListener('click', () => $('cart-modal-overlay').classList.remove('open'));
  $('cart-modal-overlay')?.addEventListener('click', e => { if (e.target === $('cart-modal-overlay')) $('cart-modal-overlay').classList.remove('open'); });
  $('btn-close-cart')?.addEventListener('click', () => $('cart-modal-overlay').classList.remove('open'));

  // Admin Product Modal
  $('btn-create-product')?.addEventListener('click', () => $('product-modal-overlay').classList.add('open'));
  $('product-modal-close')?.addEventListener('click', () => $('product-modal-overlay').classList.remove('open'));
  $('product-modal-cancel')?.addEventListener('click', () => $('product-modal-overlay').classList.remove('open'));
  $('product-modal-overlay')?.addEventListener('click', e => { if (e.target === $('product-modal-overlay')) $('product-modal-overlay').classList.remove('open'); });

  // Store Detail Modal
  $('store-details-close')?.addEventListener('click', () => $('store-details-overlay').classList.remove('open'));
  $('store-details-overlay')?.addEventListener('click', e => { if (e.target === $('store-details-overlay')) $('store-details-overlay').classList.remove('open'); });
  $('product-form')?.addEventListener('submit', handleProductSubmit);
}

// ─── Search ────────────────────────────────────────────────────────────────────
async function triggerSearch(query) {
  if (!query || !query.trim()) return;
  location.hash = '#search';
  showPage('page-search-results');
  setNavActive('nav-search');

  const navInput = $('nav-search-input');
  if (navInput) navInput.value = query;

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
  console.log('Login attempt started');
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  const errEl = $('login-error');
  errEl.classList.remove('show');

  if (!email || !password) {
    errEl.textContent = 'Completa todos los campos.';
    errEl.classList.add('show');
    return;
  }

  const btn = e.target.querySelector('button[type="submit"]') || $('btn-login-submit');
  if (!btn) {
    console.error('Login button not found');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span> Ingresando...';

  try {
    console.log('Calling loginUser...');
    await loginUser(email, password);
    console.log('loginUser successful');
    closeAuthModal();
    showToast('¡Bienvenido de vuelta! 👋', 'success');
    e.target.reset();
    location.hash = '#decks';
  } catch (err) {
    console.error('Login error:', err);
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

  if (!email || !password) {
    errEl.textContent = 'Completa todos los campos.';
    errEl.classList.add('show');
    return;
  }
  if (password.length < 6) {
    errEl.textContent = 'La contraseña debe tener al menos 6 caracteres.';
    errEl.classList.add('show');
    return;
  }

  const btn = e.target.querySelector('button[type="submit"]');
  if (!btn) return;

  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span> Registrando...';

  try {
    console.log('Calling registerUser...');
    // We race the registration with a small timeout to avoid UI hang if Firestore sync is slow
    await Promise.race([
      registerUser(email, password),
      new Promise(resolve => setTimeout(resolve, 1500))
    ]);

    console.log('Register successful/offline-queued');
    closeAuthModal();
    showToast('¡Cuenta creada exitosamente! 🎉', 'success');
    e.target.reset();
    location.hash = '#decks';
  } catch (err) {
    console.error('Register error:', err);
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
  currentUser = null;
  currentDecks = null; // Clear cache
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
    'auth/operation-not-allowed': 'El registro con email no está habilitado en Firebase. Actívalo en la consola.',
    'auth/invalid-email': 'El formato del email no es válido.',
    'auth/internal-error': 'Error interno de Firebase.',
    'auth/too-many-requests': 'Demasiados intentos. Intenta más tarde.',
    'auth/network-request-failed': 'Error de conexión. Verifica tu internet.'
  };
  return map[code] || 'Ocurrió un error inesperado. Inténtalo de nuevo.';
}

// ─── Decks Page ────────────────────────────────────────────────────────────────
async function loadDecksPage() {
  const container = $('decks-grid');
  if (!container) return;

  // Show cache immediately if available, otherwise spinner
  if (!currentDecks) {
    container.innerHTML = `<div class="empty-state"><div class="loading-spinner" style="width:32px;height:32px;margin:0 auto"></div></div>`;
  } else {
    renderDecksGrid(currentDecks);
  }

  // Subscribe for real-time updates (instant if offline/cached)
  activeSubscriptions.decks = subscribeToUserDecks(currentUser.id, (decks) => {
    currentDecks = decks;
    renderDecksGrid(decks);

    // Silent background sync check for consistency
    const needsSync = decks.filter(d => d.totalCards === undefined || d.totalCards === 0);
    needsSync.forEach(deck => {
      syncDeckStats(currentUser.id, deck.id).catch(() => { });
    });
  });
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

  container.innerHTML = decks.map(deck => {
    const totalValue = deck.totalValue != null ? `$${deck.totalValue.toFixed(2)}` : '—';
    const totalCards = deck.totalCards != null ? deck.totalCards : '—';

    return `
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
          <div class="ds-value" id="deck-stat-${deck.id}">${totalValue}</div>
          <div class="ds-label">Valor USD</div>
        </div>
        <div class="deck-stat">
          <div class="ds-value" id="deck-cards-${deck.id}">${totalCards}</div>
          <div class="ds-label">Cartas</div>
        </div>
      </div>
      <div class="deck-card-footer">
        <button class="btn btn-primary btn-sm" onclick="location.hash='#deck/${deck.id}'">Ver baraja</button>
        <button class="btn btn-danger btn-sm" data-action="delete-deck" data-deck-id="${deck.id}">🗑️</button>
      </div>
    </div>`;
  }).join('');

  // Bind delete
  container.querySelectorAll('[data-action="delete-deck"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      handleDeleteDeck(btn.dataset.deckId);
    });
  });
}


// ─── Deck Detail ───────────────────────────────────────────────────────────────
async function loadDeckDetailPage(deckId) {
  const container = $('deck-detail-content');
  if (!container || !deckId) return;
  container.innerHTML = `<div class="empty-state"><div class="loading-spinner" style="width:32px;height:32px;margin:0 auto"></div></div>`;

  let currentDeckData = null;
  let currentCardsData = null;

  function handleDataUpdate(deck, cards) {
    if (deck) currentDeckData = deck;
    if (cards) currentCardsData = cards;

    if (currentDeckData && currentCardsData) {
      renderDeckDetail(currentDeckData, currentCardsData, deckId);

      // Consistency check
      const summary = calculateDeckSummary(currentCardsData);
      if (currentDeckData.totalCards !== summary.cardCount) {
        syncDeckStats(currentUser.id, deckId).catch(() => { });
      }
    }
  }

  // Subscribe to deck info
  activeSubscriptions.deck = subscribeToDeck(currentUser.id, deckId, (deck) => {
    if (!deck) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Baraja no encontrada</div></div>`;
      return;
    }
    handleDataUpdate(deck, null);
  });

  // Subscribe to cards
  activeSubscriptions.cards = subscribeToDeckCards(currentUser.id, deckId, (cards) => {
    handleDataUpdate(null, cards);
  });
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
        await removeCardFromDeck(currentUser.id, deckIdFromBtn, cardId);
        showToast('Carta eliminada', 'success');
        await refreshDeckDetail(deckIdFromBtn);
      } catch (err) {
        showToast('Error al eliminar carta: ' + err.message, 'error');
        btn.disabled = false;
      }
    }

    if (action === 'qty-inc') {
      try {
        await updateCardQuantity(currentUser.id, deckIdFromBtn, cardId, currentQty + 1);
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
        await updateCardQuantity(currentUser.id, deckIdFromBtn, cardId, currentQty - 1);
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
      getDeck(currentUser.id, deckId),
      getDeckCards(currentUser.id, deckId)
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

  const btn = e.target.querySelector('button[type="submit"]') || $('btn-deck-submit');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="loading-spinner"></span> Creando...';
  }

  try {
    console.log('Calling createDeck...');
    // Race with timeout to handle potential Firestore offline hang
    await Promise.race([
      createDeck(currentUser.id, { nombre, descripcion }),
      new Promise(resolve => setTimeout(resolve, 1500))
    ]);

    console.log('createDeck initiated/successful');
    closeDeckModal();
    showToast(`Baraja "${nombre}" creada`, 'success');

    console.log('Loading decks page...');
    loadDecksPage().catch(console.error); // Don't block UI on reload
  } catch (err) {
    console.error('Create deck error:', err);
    showToast('Error al crear baraja: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '＋ Crear baraja';
    }
  }
}

async function handleDeleteDeck(deckId, redirect = false) {
  console.log('Attempting to delete deck:', deckId);
  if (!confirm('¿Estás seguro de eliminar esta baraja y todas sus cartas?')) return;
  try {
    const start = Date.now();
    // Race with a timeout to avoid UI hang if sync is slow
    await Promise.race([
      deleteDeck(currentUser.id, deckId),
      new Promise(resolve => setTimeout(resolve, 2000))
    ]);
    console.log(`Deck deleted/queued in ${Date.now() - start}ms`);

    // Clear cache to force reload
    currentDecks = null;

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

  // 1. Open modal immediately
  $('deck-selector-overlay').classList.add('open');
  const list = $('deck-selector-list');

  // 2. Show loading if decks aren't ready
  if (currentDecks === null) {
    list.innerHTML = `<div class="empty-state" style="padding:20px"><div class="loading-spinner"></div><div style="margin-top:10px;font-size:13px">Cargando tus barajas...</div></div>`;
    try {
      currentDecks = await getUserDecks(currentUser.id);
    } catch (err) {
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-desc">Error: ${escHtml(err.message)}</div></div>`;
      return;
    }
  }

  // 3. Render list (either from cache or fresh fetch)
  if (currentDecks.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📦</div>
        <div class="empty-desc">No tienes barajas todavía.</div>
        <button class="btn btn-primary btn-sm" onclick="window.__closeDS(); location.hash='#decks';">Ir a Mis Barajas</button>
      </div>`;
    return;
  }

  renderDeckSelector(currentDecks);
}

// Internal helper for inline onclick
window.__closeDS = closeDeckSelector;

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
  const item = document.querySelector(`.deck-selector-item[data-deck-id="${deckId}"]`);

  const cardData = {
    cardIdAPI: pendingCard.id,
    nombre: pendingCard.name,
    set: pendingCard.set,
    numero: pendingCard.number || null,
    imagen: pendingCard.image || null,
    precioUnitario: pendingCard.avgPrice || 0
  };

  // UI Feedback: disable and show loading
  if (item) {
    item.classList.add('loading');
    const label = item.querySelector('.dsi-count');
    if (label) label.textContent = 'Agregando...';
    // Disable all items to prevent double clicks
    document.querySelectorAll('.deck-selector-item').forEach(el => el.style.pointerEvents = 'none');
  }

  try {
    // 4. Race the addition with a timeout to avoid UI hang
    // Firestore will continue syncing in the background if offline
    await Promise.race([
      addCardToDeck(currentUser.id, deckId, cardData),
      new Promise(resolve => setTimeout(resolve, 2000))
    ]);

    // Success feedback in modal
    if (item) {
      item.classList.remove('loading');
      item.classList.add('success');
      const label = item.querySelector('.dsi-count');
      if (label) label.textContent = '¡Agregado con éxito!';
    }

    // Update local cache count if available
    const deckObj = currentDecks?.find(d => d.id === deckId);
    if (deckObj && deckObj.totalCards !== undefined) {
      deckObj.totalCards++;
    }

    showToast(`"${pendingCard.name}" agregada a "${deck?.nombre}"`, 'success');

    // Close modal after a short delay so user sees the success state
    setTimeout(closeDeckSelector, 800);
  } catch (err) {
    showToast('Error al agregar carta: ' + err.message, 'error');
    if (item) {
      item.classList.remove('loading');
      const label = item.querySelector('.dsi-count');
      if (label) label.textContent = 'Error al agregar';
      document.querySelectorAll('.deck-selector-item').forEach(el => el.style.pointerEvents = 'auto');
    }
    pendingCard = null;
  }
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

// ═══════════════════════════════════════════════════════════════════════════════
// ─── COMMUNITY MARKET ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function loadMarketPage() {
  const grid = $('market-grid');
  if (!grid) return;
  grid.innerHTML = `<div style="grid-column:1/-1;display:flex;align-items:center;justify-content:center;padding:60px 0"><div class="loading-spinner" style="width:36px;height:36px"></div></div>`;

  activeSubscriptions.market = subscribeToMarketListings((listings) => {
    allMarketListings = listings;
    renderMarketGrid(listings);
  });
}

function filterMarket(query) {
  if (!query || !query.trim()) { renderMarketGrid(allMarketListings); return; }
  const q = query.toLowerCase().trim();
  const filtered = allMarketListings.filter(l =>
    (l.nombre && l.nombre.toLowerCase().includes(q)) ||
    (l.edicion && l.edicion.toLowerCase().includes(q))
  );
  renderMarketGrid(filtered);
}

function renderMarketGrid(listings) {
  const grid = $('market-grid');
  if (!grid) return;

  if (!listings || listings.length === 0) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:80px 20px">
        <div style="font-size:56px;margin-bottom:16px">🏪</div>
        <div style="font-size:18px;font-weight:700;color:var(--text);margin-bottom:8px">El mercado está vacío</div>
        <div style="color:var(--text-muted);font-size:14px">Sé el primero en publicar una carta</div>
      </div>`;
    return;
  }

  grid.innerHTML = listings.map(l => {
    const imgHtml = l.imagenUrl
      ? `<img src="${escHtml(l.imagenUrl)}" alt="${escHtml(l.nombre)}" loading="lazy" onerror="this.parentElement.innerHTML='<span class=market-card-no-img>🃏</span>'">`
      : `<span class="market-card-no-img">🃏</span>`;

    return `
      <div class="market-card" data-id="${escHtml(l.id)}" onclick="window._openListing('${escHtml(l.id)}')">
        <div class="market-card-img-wrap">
          ${imgHtml}
          <span class="market-card-price-badge">CLP $ ${Math.round(+l.precio || 0).toLocaleString('es-CL')}</span>
        </div>
        <div class="market-card-body">
          <div class="market-card-name">${escHtml(l.nombre)}</div>
          <div class="market-card-edition">${escHtml(l.edicion || '—')}</div>
          <div class="market-card-number">#${escHtml(l.numero || '—')}</div>
        </div>
        <div class="market-card-footer">
          <span class="market-price-usd">CLP $ ${Math.round(+l.precio || 0).toLocaleString('es-CL')}</span>
          <span class="market-card-idioma">${escHtml(l.idioma || 'ES')}</span>
        </div>
      </div>`;
  }).join('');
}

// Expose to global scope for inline onclick handlers
window._openListing = openListingDetail;

async function openListingDetail(listingId) {
  const overlay = $('listing-detail-overlay');
  const body = $('listing-detail-body');
  if (!overlay || !body) return;

  overlay.classList.add('open');
  body.innerHTML = `<div style="padding:40px;text-align:center"><div class="loading-spinner"></div></div>`;

  try {
    const listing = allMarketListings.find(l => l.id === listingId);
    if (!listing) throw new Error('Publicación no encontrada');

    const seller = await getUserProfile(listing.uid);
    const isOwner = currentUser && (currentUser.id === listing.uid);

    const sameCardsCount = allMarketListings.filter(l =>
      l.id !== listingId &&
      l.nombre === listing.nombre &&
      l.edicion === listing.edicion
    ).length + 1;

    const imgHtml = listing.imagenUrl
      ? `<img src="${escHtml(listing.imagenUrl)}" alt="${escHtml(listing.nombre)}">`
      : `<span class="listing-detail-no-img">🃏</span>`;

    body.innerHTML = `
      <div class="listing-detail-layout">
        <div class="listing-detail-img">${imgHtml}</div>
        <div class="listing-detail-info">
          <div class="listing-detail-name">${escHtml(listing.nombre)}</div>
          <div class="listing-detail-price">
            CLP $ ${Math.round(+listing.precio || 0).toLocaleString('es-CL')}
          </div>
          <div class="listing-detail-attrs">
            <div class="listing-attr"><div class="listing-attr-label">Edición</div><div class="listing-attr-value">${escHtml(listing.edicion || '—')}</div></div>
            <div class="listing-attr"><div class="listing-attr-label">Rareza</div><div class="listing-attr-value">${escHtml(listing.rareza || '—')}</div></div>
            <div class="listing-attr"><div class="listing-attr-label">N° de carta</div><div class="listing-attr-value">${escHtml(listing.numero || '—')}</div></div>
            <div class="listing-attr"><div class="listing-attr-label">Idioma</div><div class="listing-attr-value">${escHtml(listing.idioma || '—')}</div></div>
          </div>
          
          <div class="seller-info" style="margin-top:20px;padding:12px;background:rgba(255,255,255,0.03);border-radius:12px;border:1px solid rgba(255,255,255,0.05)">
            <div class="seller-info-title" style="font-weight:700;margin-bottom:8px">👤 Vendedor</div>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <a href="#user/${seller.id}" onclick="closeListingDetail()" style="color:var(--primary);text-decoration:none;font-weight:600">${escHtml(seller.nickname || seller.email)}</a>
                <div style="font-size:0.75rem;opacity:0.7">${escHtml(seller.ciudad || 'Ubicación no disponible')}</div>
              </div>
              <a href="#user/${seller.id}" onclick="closeListingDetail()" class="btn btn-sm btn-outline" style="font-size:0.7rem">Ver Perfil</a>
            </div>
          </div>

          <div class="listing-actions" style="margin-top:24px;display:flex;gap:12px;align-items:center">
            ${isOwner ? `
              <button class="btn btn-danger" onclick="window._deleteListing('${listing.id}')" style="flex:1">Eliminar publicación</button>
            ` : `
               <label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;white-space:nowrap">
                 Cantidad:
                 <input type="number" id="buyer-quantity" min="1" max="${listing.cantidad || 1}" value="1" style="width:60px;padding:6px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.2);color:#fff;border-radius:4px" />
               </label>
              <button class="btn btn-primary" id="btn-contact-seller" style="flex:1">💬 Contactar al vendedor</button>
            `}
          </div>

          <div class="same-card-count" style="margin-top:16px;font-size:0.8rem;opacity:0.6">
            <strong>${sameCardsCount}</strong> publicación(es) de esta carta disponible(s)
          </div>
        </div>
      </div>`;

    $('btn-contact-seller')?.addEventListener('click', async (e) => {
      if (!currentUser) {
        showToast("Debes iniciar sesión para contactar al vendedor", 'warning');
        openAuthModal('login');
        return;
      }
      const btn = e.currentTarget;
      const qtyInput = $('buyer-quantity');
      const qty = qtyInput ? parseInt(qtyInput.value, 10) || 1 : 1;

      if (qty > (listing.cantidad || 1)) {
        showToast("No puedes comprar más de las unidades publicadas (" + (listing.cantidad || 1) + ").", 'error');
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<span class="loading-spinner"></span> Iniciando chat...';
      try {
        const conv = await getOrCreateConversation(listing.id, listing.uid, listing, qty);
        closeListingDetail();
        location.hash = `#chat/${conv.id}`;
      } catch (err) {
        showToast("Error al iniciar chat: " + err.message, 'error');
        btn.disabled = false;
        btn.innerHTML = '💬 Contactar al vendedor';
      }
    });

  } catch (err) {
    console.error('Error loading listing detail:', err);
    body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--danger)">Error: ${escHtml(err.message)}</div>`;
  }
}

window._deleteListing = async function (listingId) {
  if (!confirm('¿Seguro que deseas eliminar esta publicación (Admin)?')) return;
  try {
    await deactivateMarketListing(listingId);
    showToast('Publicación eliminada por administrador.', 'success');
    closeListingDetail();
  } catch (err) {
    showToast('Error al eliminar: ' + err.message, 'error');
  }
};

function closeListingDetail() {
  $('listing-detail-overlay')?.classList.remove('open');
}
// Expose for inline onclick handlers in dynamically generated HTML
window.closeListingDetail = closeListingDetail;

// ─── Sell Modal ────────────────────────────────────────────────────────────────
let lastFetchedRecommendedPrice = 0;
let _priceSuggestionAbort = null; // AbortController for in-flight price suggestion

function openSellModal() {
  if (!currentUser) { showToast('Debes iniciar sesión para vender', 'warning'); return; }
  const form = $('sell-form');
  if (form) { form.reset(); delete form.dataset.imgUrl; }
  const sugg = $('sell-price-suggestion');
  if (sugg) sugg.innerHTML = '<span class="price-label">Precio recomendado</span><span style="color:var(--text-faint);font-size:12px">Ingresa nombre y edición para obtener recomendación</span>';
  const err = $('sell-error');
  if (err) err.textContent = '';
  lastFetchedRecommendedPrice = 0;
  $('sell-modal-overlay')?.classList.add('open');
}

function closeSellModal() {
  $('sell-modal-overlay')?.classList.remove('open');
}

async function fetchPriceSuggestion() {
  const nombre = $('sell-nombre')?.value?.trim();
  if (!nombre) return;
  const edicion = $('sell-edicion')?.value?.trim();
  const sugg = $('sell-price-suggestion');
  if (!sugg) return;

  // Cancel any previous in-flight request
  if (_priceSuggestionAbort) _priceSuggestionAbort.abort();
  _priceSuggestionAbort = new AbortController();
  const signal = _priceSuggestionAbort.signal;

  sugg.innerHTML = '<span class="price-label">Precio recomendado</span><span style="color:var(--text-faint);font-size:12px">Buscando precio...</span>';

  try {
    const query = edicion ? `${nombre} ${edicion}` : nombre;
    const data = await searchCards(query);
    if (signal.aborted) return; // Form was submitted, discard result
    const cards = data?.cards || data?.data || [];

    if (cards.length > 0) {
      const card = cards[0];
      const marketPrice = card.cardmarket?.prices?.averageSellPrice
        || card.tcgplayer?.prices?.normal?.market
        || card.tcgplayer?.prices?.holofoil?.market
        || null;

      if (marketPrice) {
        lastFetchedRecommendedPrice = marketPrice;
        const clpPrice = (marketPrice * clpRate).toFixed(0);
        sugg.innerHTML = `
          <span class="price-label">💡 Precio recomendado</span>
          <span class="price-value">$${marketPrice.toFixed(2)}</span>
          <span class="price-sub">≈ CLP $${Number(clpPrice).toLocaleString('es-CL')}</span>`;
        const priceInput = $('sell-precio');
        if (priceInput && !priceInput.value) priceInput.value = marketPrice.toFixed(2);
        const imgUrl = card.images?.small || null;
        const form = $('sell-form');
        if (imgUrl && form) form.dataset.imgUrl = imgUrl;
      } else {
        sugg.innerHTML = '<span class="price-label">Precio recomendado</span><span style="color:var(--text-faint);font-size:12px">Sin datos de precio disponibles</span>';
      }
    } else {
      sugg.innerHTML = '<span class="price-label">Precio recomendado</span><span style="color:var(--text-faint);font-size:12px">Carta no encontrada en la API</span>';
    }
  } catch (_) {
    if (signal.aborted) return;
    sugg.innerHTML = '<span class="price-label">Precio recomendado</span><span style="color:var(--text-faint);font-size:12px">No se pudo obtener precio</span>';
  }
}

async function handleSubmitListing(e) {
  e.preventDefault();
  const errEl = $('sell-error');
  if (errEl) errEl.textContent = '';

  const nombre = $('sell-nombre')?.value?.trim();
  const precio = parseFloat($('sell-precio')?.value);

  if (!nombre) { if (errEl) errEl.textContent = 'El nombre de la carta es requerido.'; return; }
  if (!precio || precio <= 0) { if (errEl) errEl.textContent = 'Ingresa un precio válido mayor a 0.'; return; }

  // Abort any in-flight price suggestion so it doesn't interfere
  if (_priceSuggestionAbort) { _priceSuggestionAbort.abort(); _priceSuggestionAbort = null; }

  const btn = $('btn-sell-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'Publicando...'; }

  // Grab image URL before closing (dataset is on the form element)
  const form = $('sell-form');
  const imgUrl = form?.dataset?.imgUrl || null;

  try {
    await createMarketListing(currentUser.id, {
      nombre,
      edicion: $('sell-edicion')?.value?.trim() || '',
      rareza: $('sell-rareza')?.value || '',
      numero: $('sell-numero')?.value?.trim() || '',
      ilustrador: $('sell-ilustrador')?.value?.trim() || '',
      idioma: $('sell-idioma')?.value || 'Español',
      cantidad: parseInt($('sell-cantidad')?.value) || 1,
      precio: Math.round(precio),
      precioRecomendado: lastFetchedRecommendedPrice,
      imagenUrl: imgUrl
    });
    // Close immediately after Firestore write - don't wait for hash navigation
    closeSellModal();
    showToast('¡Carta publicada en el mercado! 🎉', 'success');
    if (location.hash !== '#market') location.hash = '#market';
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
    showToast('Error al publicar: ' + err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '📤 Publicar en el mercado'; }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── USER PROFILE ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function loadProfilePage() {
  const container = $('profile-content');
  if (!container || !currentUser) return;
  container.innerHTML = `<div style="display:flex;align-items:center;gap:12px;padding:40px"><div class="loading-spinner" style="width:28px;height:28px"></div></div>`;

  try {
    const profile = await getUserProfile(currentUser.id);

    container.innerHTML = `
      <div class="profile-avatar">👤</div>
      <div class="form-group" style="margin-bottom:16px">
        <div class="profile-field-label">Correo electrónico</div>
        <div class="profile-email-display">${escHtml(currentUser.email)}</div>
      </div>
      <form id="profile-form" novalidate>
        <div class="form-group" style="margin-bottom:16px">
          <label class="form-label" for="profile-nickname">Nickname (visible en el mercado)</label>
          <input class="form-input" type="text" id="profile-nickname"
            value="${escHtml(profile.nickname || '')}"
            placeholder="Tu nombre de usuario" maxlength="40" />
        </div>
        <div class="form-group" style="margin-bottom:16px">
          <label class="form-label" for="profile-phone">Número de teléfono</label>
          <input class="form-input" type="text" id="profile-phone"
            value="${escHtml(profile.phone_number || '')}"
            placeholder="Ej: +56 9 1234 5678" maxlength="20" />
        </div>
        <div class="form-group" style="margin-bottom:20px">
          <label class="form-label" for="profile-ciudad">Ciudad</label>
          <input class="form-input" type="text" id="profile-ciudad"
            value="${escHtml(profile.ciudad || '')}"
            placeholder="Ej: Santiago, Buenos Aires..." maxlength="60" />
        </div>
        <div style="display:flex;gap:12px;align-items:center">
          <button type="submit" class="btn btn-primary">💾 Guardar cambios</button>
          <p class="form-error" id="profile-error" style="margin:0"></p>
        </div>
      </form>`;

    container.querySelector('#profile-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = container.querySelector('#profile-error');
      if (errEl) errEl.textContent = '';
      const btn = container.querySelector('[type=submit]');
      if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
      try {
        await updateUserProfile(currentUser.id, {
          nickname: container.querySelector('#profile-nickname')?.value?.trim() || '',
          phone_number: container.querySelector('#profile-phone')?.value?.trim() || '',
          ciudad: container.querySelector('#profile-ciudad')?.value?.trim() || ''
        });
        showToast('Perfil actualizado correctamente ✅', 'success');
      } catch (err) {
        if (errEl) errEl.textContent = err.message;
        showToast('Error al guardar: ' + err.message, 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar cambios'; }
      }
    });
  } catch (err) {
    container.innerHTML = `<div style="color:var(--danger);padding:24px">Error cargando perfil: ${escHtml(err.message)}</div>`;
  }
}
// ─── Store & Cart Logic ────────────────────────────────────────────────────────
async function loadStorePage() {
  const grid = $('store-grid');
  grid.innerHTML = '<div class="loading-state">Cargando tienda...</div>';

  try {
    const products = await store.getProducts();
    allStoreProducts = products;
    renderStoreGrid(products);
  } catch (err) {
    console.error('Error cargando tienda:', err);
    grid.innerHTML = '<div class="error-state">Error al cargar los productos de la tienda.</div>';
  }
}

function renderStoreGrid(products) {
  const grid = $('store-grid');
  if (!products || products.length === 0) {
    grid.innerHTML = '<div class="empty-state">No hay productos disponibles en este momento.</div>';
    return;
  }

  grid.innerHTML = products.map(p => `
    <article class="store-card" onclick="openStoreProductDetail('${p.id}')">
      <div class="store-card-image">
        <img src="${p.imagen_url || 'https://via.placeholder.com/300x200?text=No+Image'}" alt="${p.nombre}">
      </div>
      <div class="store-card-body">
        <h3 class="store-card-title">${p.nombre}</h3>
        <div class="store-card-price">CLP $ ${Math.round(p.precio).toLocaleString('es-CL')}</div>
        <p class="store-card-description">${p.descripcion}</p>
        <div class="store-card-footer">
          <button class="btn btn-primary w-100" onclick="event.stopPropagation(); handleAddToCart('${p.id}')">🛒 Agregar al Carrito</button>
        </div>
      </div>
      ${currentUser?.role === 'admin' ? `
        <button class="btn btn-danger btn-sm" style="position:absolute;top:10px;right:10px" onclick="handleDeleteProduct('${p.id}')">🗑️</button>
      ` : ''}
    </article>
  `).join('');
}

window.openStoreProductDetail = openStoreProductDetail;

async function openStoreProductDetail(productId) {
  const overlay = $('store-details-overlay');
  const body = $('store-details-body');
  if (!overlay || !body) return;

  // Find product in current state
  const product = allStoreProducts.find(p => p.id === productId);
  if (!product) return;

  overlay.classList.add('open');
  body.innerHTML = `
    <div class="product-detail-layout">
      <div class="product-detail-img">
        <img src="${product.imagen_url || 'https://via.placeholder.com/400x300?text=No+Image'}" alt="${product.nombre}">
      </div>
      <div class="product-detail-info">
        <div class="product-detail-info-header">
          <h2 class="product-detail-name">${product.nombre}</h2>
          <div class="product-detail-price">CLP $ ${Math.round(product.precio).toLocaleString('es-CL')}</div>
        </div>
        <div class="product-detail-description">
          <p>${product.descripcion || 'Sin descripción disponible.'}</p>
        </div>
        <div class="product-detail-actions">
          <button class="btn btn-primary btn-lg w-100" onclick="handleAddToCart('${product.id}')">🛒 Agregar al Carrito</button>
        </div>
      </div>
    </div>
  `;
}

window.handleAddToCart = async function (productId) {
  if (!currentUser) {
    showToast('Inicia sesión para usar el carrito', 'warning');
    $('auth-modal-overlay').classList.add('open');
    return;
  }

  try {
    await store.addToCart(currentUser.id, productId);
    showToast('Producto añadido al carrito', 'success');
    updateCartBadge();
  } catch (err) {
    console.error('Error adding to cart:', err);
    showToast('Error al añadir al carrito', 'danger');
  }
};

window.handleDeleteProduct = async function (productId) {
  if (!confirm('¿Seguro que quieres eliminar este producto de la tienda?')) return;
  try {
    await store.deleteProduct(productId);
    showToast('Producto eliminado', 'success');
    loadStorePage();
  } catch (err) {
    console.error('Error deleting product:', err);
    showToast('Error al eliminar producto', 'danger');
  }
};

async function updateCartBadge() {
  if (!currentUser) return;
  try {
    const items = await store.getCartItems(currentUser.id);
    const count = items.reduce((acc, item) => acc + item.cantidad, 0);
    const badge = $('cart-count-badge');
    if (badge) badge.textContent = count;
  } catch (err) {
    console.error('Error updating cart badge:', err);
  }
}

async function openCartModal() {
  const overlay = $('cart-modal-overlay');
  overlay.classList.add('open');

  const list = $('cart-items-list');
  list.innerHTML = '<div class="loading-state">Cargando carrito...</div>';
  $('cart-summary').innerHTML = '';

  try {
    const items = await store.getCartItems(currentUser.id);
    renderCart(items);
  } catch (err) {
    console.error('Error loading cart:', err);
    list.innerHTML = '<div class="error-state">Error al cargar el carrito.</div>';
  }
}

function renderCart(items) {
  const list = $('cart-items-list');
  const summary = $('cart-summary');
  const footer = $('cart-modal-footer');

  if (!items || items.length === 0) {
    list.innerHTML = `
      <div class="empty-cart">
        <span class="empty-cart-icon">🛒</span>
        <p>Tu carrito está vacío</p>
      </div>
    `;
    summary.innerHTML = '';
    footer.style.display = 'none';
    return;
  }

  footer.style.display = 'flex';

  let total = 0;
  list.innerHTML = items.map(item => {
    const p = item.products;
    const itemTotal = p.precio * item.cantidad;
    total += itemTotal;

    return `
      <div class="cart-item">
        <div class="cart-item-image">
          <img src="${p.imagen_url}" alt="${p.nombre}">
        </div>
        <div class="cart-item-info">
          <div class="cart-item-name">${p.nombre}</div>
          <div class="cart-item-price">CLP $ ${Math.round(p.precio).toLocaleString('es-CL')}</div>
        </div>
        <div class="cart-item-actions">
          <div class="qty-control">
            <button class="qty-btn" onclick="handleUpdateCartQty('${item.id}', ${item.cantidad - 1})">-</button>
            <span class="qty-value">${item.cantidad}</span>
            <button class="qty-btn" onclick="handleUpdateCartQty('${item.id}', ${item.cantidad + 1})">+</button>
          </div>
          <button class="btn btn-ghost danger" onclick="handleRemoveFromCart('${item.id}')">🗑️</button>
        </div>
      </div>
    `;
  }).join('');

  summary.innerHTML = `
    <div class="summary-row">
      <span>Subtotal</span>
      <span>CLP $ ${Math.round(total).toLocaleString('es-CL')}</span>
    </div>
    <div class="summary-row">
      <span>Envío</span>
      <span>Calculado en el checkout</span>
    </div>
    <div class="summary-row summary-total">
      <span>Total</span>
      <span>CLP $ ${Math.round(total).toLocaleString('es-CL')}</span>
    </div>
  `;
}

window.handleUpdateCartQty = async function (itemId, newQty) {
  try {
    await store.updateCartItemQuantity(currentUser.id, itemId, newQty);
    const items = await store.getCartItems(currentUser.id);
    renderCart(items);
    updateCartBadge();
  } catch (err) {
    console.error('Error updating cart qty:', err);
  }
};

window.handleRemoveFromCart = async function (itemId) {
  try {
    await store.removeFromCart(currentUser.id, itemId);
    const items = await store.getCartItems(currentUser.id);
    renderCart(items);
    updateCartBadge();
    showToast('Producto eliminado del carrito', 'success');
  } catch (err) {
    console.error('Error removing from cart:', err);
  }
};

async function handleProductSubmit(e) {
  e.preventDefault();
  const form = $('product-form');
  const errorEl = $('product-error');
  const btn = $('btn-product-submit');

  const nombre = $('product-nombre').value.trim();
  const precio = parseFloat($('product-precio').value);
  const descripcion = $('product-descripcion').value.trim();
  const imagen_url = $('product-imagen').value.trim();

  if (!nombre || isNaN(precio) || precio <= 0 || !descripcion || !imagen_url) {
    errorEl.textContent = 'Por favor completa todos los campos obligatorios y asegúrate de que el precio sea válido.';
    return;
  }

  try {
    btn.disabled = true;
    btn.textContent = 'Publicando...';
    await store.createProduct({ nombre, precio, descripcion, imagen_url });

    showToast('Producto publicado exitosamente', 'success');
    form.reset();
    $('product-modal-overlay').classList.remove('open');
    loadStorePage();
  } catch (err) {
    console.error('Error creating product:', err);
    errorEl.textContent = 'Error al publicar el producto.';
  } finally {
    btn.disabled = false;
    btn.textContent = '📦 Publicar Producto';
  }
}

// ─── CHAT & MESSAGING ────────────────────────────────────────────────────────

async function loadChatPage(conversationId = null) {
  const container = $('chat-container-layout');
  if (!container) return;

  container.innerHTML = `
    <div class="chat-layout">
      <div class="chat-sidebar" id="chat-sidebar">
        <div style="padding:20px;text-align:center"><div class="loading-spinner"></div></div>
      </div>
      <div class="chat-main" id="chat-main">
        <div class="chat-empty-state">
          <div style="font-size:48px;margin-bottom:16px">💬</div>
          <h3>Selecciona una conversación</h3>
          <p>Tus mensajes aparecerán aquí cuando compres o alguien quiera comprar tus cartas.</p>
        </div>
      </div>
    </div>`;

  try {
    const convs = await getConversations();
    let activeConv = convs.find(c => c.id === conversationId);

    // If conversationId refers to a brand-new conversation not yet in the list, fetch it directly
    if (conversationId && !activeConv) {
      activeConv = await getConversationById(conversationId);
      if (activeConv) convs.unshift(activeConv);
    }

    renderConversationList(convs, conversationId);

    if (activeConv) {
      renderActiveChat(activeConv);
    }

    // Subscribe to new incoming conversations (when another user contacts this user as seller)
    if (currentUser) {
      const unsubNewConvs = subscribeToNewConversations(currentUser.id, (newConv) => {
        // Add to top of list if not already present
        const sidebar = $('chat-sidebar');
        if (!sidebar) return;
        showToast(`💬 Nueva conversación de ${newConv.buyer?.nickname || newConv.buyer?.email || 'Un usuario'}`, 'info');
        // Re-render the sidebar by prepending the new convo
        convs.unshift(newConv);
        renderConversationList(convs, conversationId);
      });
      activeSubscriptions['seller_new_convs'] = unsubNewConvs;
    }
  } catch (err) {
    console.error("Error loading chat page:", err);
  }
}

function renderConversationList(convs, activeId) {
  const sidebar = $('chat-sidebar');
  if (!sidebar) return;

  if (!convs || convs.length === 0) {
    sidebar.innerHTML = `<div style="padding:40px;text-align:center;opacity:0.6;font-size:0.9rem">No tienes conversaciones aún.</div>`;
    return;
  }

  sidebar.innerHTML = `
    <div class="conv-list">
      ${convs.map(c => {
    const isSelected = c.id === activeId ? 'active' : '';
    const partner = currentUser.id === c.buyer_id ? c.seller : c.buyer;
    const lastMsg = c.lastMessage;
    const lastMsgText = lastMsg ? escHtml(lastMsg.content.length > 42 ? lastMsg.content.slice(0, 42) + '…' : lastMsg.content) : '<em style="opacity:0.5">Sin mensajes aún</em>';
    const lastMsgDate = lastMsg ? formatConvDate(lastMsg.created_at) : '';
    const isMine = lastMsg && lastMsg.sender_id === currentUser.id;
    let senderPrefix = '';
    if (lastMsg) {
      senderPrefix = isMine ? 'Tú: ' : (partner?.nickname || partner?.email || 'Usuario') + ': ';
    }
    return `
          <div class="conv-item ${isSelected}" onclick="location.hash='#chat/${c.id}'">
            <div class="conv-avatar">👤</div>
            <div class="conv-info">
              <div class="conv-header-row" style="display:flex;justify-content:space-between;align-items:baseline;gap:4px">
                <div class="conv-partner" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${escHtml(partner?.nickname || partner?.email || 'Usuario')}</div>
                ${lastMsgDate ? `<div class="conv-date" style="font-size:0.7rem;opacity:0.5;white-space:nowrap;flex-shrink:0">${lastMsgDate}</div>` : ''}
              </div>
              <div class="conv-last-msg" style="font-size:0.78rem;opacity:0.65;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px"><span style="font-weight:600;opacity:0.8">${escHtml(senderPrefix)}</span>${lastMsgText}</div>
            </div>
          </div>
        `;
  }).join('')}
    </div>`;
}

function formatConvDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  // Check if same year
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
  }
  return d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function renderActiveChat(conv) {
  const main = $('chat-main');
  if (!main) return;

  const partner = currentUser.id === conv.buyer_id ? conv.seller : conv.buyer;

  main.innerHTML = `
    <div class="chat-active-header">
      <div style="display:flex;align-items:center;gap:12px">
        <div class="conv-avatar">👤</div>
        <div>
          <div style="font-weight:700">${escHtml(partner?.nickname || partner?.email || 'Usuario')}</div>
          <div style="font-size:0.75rem;opacity:0.7">Negociando: ${escHtml(conv.listing?.nombre)}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <a href="#user/${partner?.id}" class="btn btn-outline btn-sm">Ver Perfil</a>
        ${currentUser.id === conv.buyer_id ? `<button class="btn btn-primary btn-sm" id="btn-finish-deal">Finalizar y Calificar</button>` : ''}
      </div>
    </div>
    <div class="chat-messages" id="chat-messages-box">
      <div style="padding:40px;text-align:center"><div class="loading-spinner"></div></div>
    </div>
    <form class="chat-input-area" id="chat-send-form">
      <input type="text" id="chat-msg-input" placeholder="Escribe un mensaje..." autocomplete="off" />
      <button type="submit" class="btn btn-primary">Enviar</button>
    </form>
  `;

  try {
    const messages = await getMessages(conv.id);
    displayMessages(messages);

    activeSubscriptions[`chat_${conv.id}`]?.();
    const unsub = subscribeToMessages(conv.id, (newMsg) => {
      appendMessage(newMsg);
    });
    activeSubscriptions[`chat_${conv.id}`] = unsub;
  } catch (err) {
    console.error("Error loading messages:", err);
  }

  $('chat-send-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('chat-msg-input');
    const content = input.value.trim();
    if (!content) return;
    input.value = '';
    try {
      await sendMessage(conv.id, content);
    } catch (err) {
      showToast("Error al enviar: " + err.message, 'error');
    }
  });

  $('btn-finish-deal')?.addEventListener('click', () => openReviewModal(conv));
}

function displayMessages(messages) {
  const box = $('chat-messages-box');
  if (!box) return;
  box.innerHTML = messages.map(renderMessageHTML).join('');
  box.scrollTop = box.scrollHeight;
}

function appendMessage(msg) {
  const box = $('chat-messages-box');
  if (!box) return;
  const div = document.createElement('div');
  div.innerHTML = renderMessageHTML(msg);
  box.appendChild(div.firstElementChild);
  box.scrollTop = box.scrollHeight;
}

function renderMessageHTML(msg) {
  const isMe = msg.sender_id === currentUser.id;
  const senderName = msg.sender?.nickname || msg.sender?.email || (isMe ? 'Tú' : 'Usuario');
  const msgDate = msg.created_at
    ? new Date(msg.created_at).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '';
  return `
    <div class="msg-row ${isMe ? 'msg-me' : 'msg-them'}">
      <div class="msg-sender-name">${escHtml(isMe ? 'Tú' : senderName)}</div>
      <div class="msg-bubble">${escHtml(msg.content)}</div>
      <div class="msg-time">${msgDate}</div>
    </div>
  `;
}

function openReviewModal(conv) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay open';
  modal.id = 'review-modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Calificar vendedor</span>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
      </div>
      <div class="modal-body">
        <p>¿Qué te pareció la transacción con <b>${escHtml(conv.seller?.nickname || conv.seller?.email || 'Vendedor')}</b>?</p>
        <div class="rating-stars" style="display:flex;gap:8px;margin:20px 0;justify-content:center;font-size:2rem;cursor:pointer">
          <span data-v="1">☆</span><span data-v="2">☆</span><span data-v="3">☆</span><span data-v="4">☆</span><span data-v="5">☆</span>
        </div>
        <textarea id="review-comment" class="form-input" placeholder="Escribe un comentario opcional..." rows="3"></textarea>
        <div class="modal-footer" style="padding:1rem 0 0 0;border:none">
          <button class="btn btn-primary" id="btn-submit-review" style="width:100%" disabled>Enviar Calificación</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  let selectedRating = 0;
  const stars = modal.querySelectorAll('.rating-stars span');
  stars.forEach(s => {
    s.addEventListener('click', () => {
      selectedRating = parseInt(s.dataset.v);
      stars.forEach((st, i) => st.textContent = i < selectedRating ? '★' : '☆');
      modal.querySelector('#btn-submit-review').disabled = false;
    });
  });

  modal.querySelector('#btn-submit-review').addEventListener('click', async () => {
    const comment = modal.querySelector('#review-comment').value;
    try {
      await submitReview(conv.seller_id, conv.id, selectedRating, comment);
      showToast("¡Gracias por tu calificación!", 'success');
      modal.remove();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function loadPublicProfilePage(uid) {
  const container = $('user-profile-content');
  if (!container) return;

  container.innerHTML = `<div style="padding:60px;text-align:center"><div class="loading-spinner"></div></div>`;

  try {
    const profile = await getPublicProfile(uid);
    const reviews = await getUserReviews(uid);

    container.innerHTML = `
      <div class="public-profile-card">
        <div class="profile-header-main" style="display:flex;gap:20px;align-items:center;margin-bottom:30px">
          <div class="profile-avatar-large" style="font-size:3rem;background:rgba(255,255,255,0.05);width:80px;height:80px;display:flex;align-items:center;justify-content:center;border-radius:50%">👤</div>
          <div class="profile-meta">
            <h2 style="margin:0">${escHtml(profile.nickname || 'Entrenador')}</h2>
            <div style="opacity:0.7">${escHtml(profile.email)}</div>
            <div class="rating-badge" style="margin-top:8px;background:rgba(255,193,7,0.1);color:#ffc107;padding:4px 12px;border-radius:20px;display:inline-block;font-weight:700">
              ${profile.totalReviews > 0 ? `⭐ ${profile.avgRating.toFixed(1)} (${profile.totalReviews} valoraciones)` : 'Sin valoraciones aún'}
            </div>
          </div>
        </div>
        
        <div class="profile-details-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:32px;padding-top:24px;border-top:1px solid rgba(255,255,255,0.1)">
          <div>
            <div style="font-size:0.8rem;opacity:0.6;margin-bottom:4px">Ciudad</div>
            <div style="font-weight:600">${escHtml(profile.ciudad || 'No especificada')}</div>
          </div>
          <div>
            <div style="font-size:0.8rem;opacity:0.6;margin-bottom:4px">Teléfono de contacto</div>
            <div style="font-weight:600">${escHtml(profile.phone_number || 'No especificado')}</div>
          </div>
          <div style="grid-column:1/-1">
            <div style="font-size:0.8rem;opacity:0.6;margin-bottom:4px">Miembro desde</div>
            <div style="font-weight:600">${new Date(profile.created_at).toLocaleDateString()}</div>
          </div>
        </div>

        <div class="profile-reviews-section" style="margin-top:40px">
          <h3 style="margin-bottom:20px;border-bottom:1px solid rgba(255,255,255,0.05);padding-bottom:8px">Valoraciones</h3>
          <div class="reviews-list">
            ${reviews.map(r => `
              <div class="review-item" style="padding:16px;background:rgba(255,255,255,0.03);border-radius:12px;margin-bottom:12px;border:1px solid rgba(255,255,255,0.05)">
                <div style="display:flex;justify-content:space-between;margin-bottom:8px">
                  <span style="font-weight:600;color:var(--primary)">${escHtml(r.reviewer?.nickname || 'Usuario')}</span>
                  <span style="color:#ffc107">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
                </div>
                <p style="margin:0;font-size:0.9rem;opacity:0.8;line-height:1.5">${escHtml(r.comment || 'Sin comentario.')}</p>
                <div style="font-size:0.75rem;opacity:0.5;margin-top:8px">${new Date(r.created_at).toLocaleDateString()}</div>
              </div>
            `).join('') || '<p style="opacity:0.5;text-align:center;padding:20px">Nadie ha calificado a este usuario todavía.</p>'}
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div style="padding:40px;color:var(--danger)">Error al cargar perfil: ${escHtml(err.message)}</div>`;
  }
}
