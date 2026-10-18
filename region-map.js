/**
 * <region-map> Custom Element
 * Wix Studio / Velo 用 オリジナル地域マップ Webコンポーネント
 *
 * 外部ライブラリ: MapLibre GL JS (CDNから動的ロード)
 * 地図タイル: MapTiler (要APIキー。属性 maptiler-key で指定)
 *
 * 属性 (Velo側の $w('#regionMap').setAttribute(...) で更新する想定):
 *   - maptiler-key : string   MapTiler APIキー (必須)
 *   - map-style    : string   MapTiler スタイル名 省略時 'streets-v2'
 *   - lang         : 'ja'|'en'  表示言語 省略時 'ja'
 *   - data-areas   : JSON文字列  [{id,nameJa,nameEn,center:[lng,lat],zoom}, ...]
 *   - data-shops   : JSON文字列  [{id,name,nameEn,address,lat,lng,area,genres:[],
 *                                  descriptionJa,descriptionEn,photo,hours,url,sns,pinIcon}, ...]
 *
 * 発行イベント:
 *   - 'ready'        地図初期化完了
 *   - 'shopselected' { detail: { id } } ピンまたは詳細パネルを開いたとき
 */
(function () {
  const MAPLIBRE_JS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
  const MAPLIBRE_CSS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';

  const GENRES = [
    { id: 'eat', ja: '食べる', en: 'Eat', icon: '🍴', color: '#e8734a' },
    { id: 'cafe', ja: 'カフェ', en: 'Cafe', icon: '☕', color: '#b07d3f' },
    { id: 'shop', ja: '買う', en: 'Shop', icon: '🛍️', color: '#4a90a4' },
    { id: 'sightseeing', ja: '観光', en: 'Sightseeing', icon: '⛩️', color: '#8a5fb0' },
    { id: 'stay', ja: '宿泊', en: 'Stay', icon: '🛏️', color: '#5a9e6f' },
  ];

  const STRINGS = {
    ja: {
      all: '全エリア',
      searchPlaceholder: 'キーワードで検索',
      noResults: '該当する店舗がありません',
      directions: '経路を開く',
      close: '閉じる',
      hours: '営業時間',
      website: 'ウェブサイト・SNS',
      address: '住所',
    },
    en: {
      all: 'All Areas',
      searchPlaceholder: 'Search by keyword',
      noResults: 'No matching spots',
      directions: 'Get Directions',
      close: 'Close',
      hours: 'Hours',
      website: 'Website / SNS',
      address: 'Address',
    },
  };

  let mapLibreLoadPromise = null;
  function loadMapLibre() {
    if (window.maplibregl) return Promise.resolve();
    if (mapLibreLoadPromise) return mapLibreLoadPromise;
    mapLibreLoadPromise = new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = MAPLIBRE_CSS;
      document.head.appendChild(link);

      const script = document.createElement('script');
      script.src = MAPLIBRE_JS;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load MapLibre GL JS'));
      document.head.appendChild(script);
    });
    return mapLibreLoadPromise;
  }

  const TEMPLATE = `
    <link rel="stylesheet" href="${MAPLIBRE_CSS}">
    <style>
      :host {
        display: block;
        position: relative;
        width: 100%;
        height: 100%;
        min-height: 420px;
        --rm-accent: #e8734a;
        --rm-bg: #fdf8f0;
        --rm-text: #3a2e26;
        --rm-border: #e8ddc9;
        --rm-font: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif;
        font-family: var(--rm-font);
        color: var(--rm-text);
        overflow: hidden;
        box-sizing: border-box;
      }
      *, *::before, *::after { box-sizing: border-box; }
      .rm-root { position: absolute; inset: 0; }
      .rm-map { position: absolute; inset: 0; }

      .rm-topbar {
        position: absolute;
        top: 0; left: 0; right: 0;
        z-index: 5;
        padding: 10px 10px 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
        pointer-events: none;
      }
      .rm-row {
        display: flex;
        gap: 6px;
        align-items: center;
        overflow-x: auto;
        pointer-events: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
      }
      .rm-row::-webkit-scrollbar { display: none; }

      .rm-chip {
        flex: 0 0 auto;
        border: 1px solid var(--rm-border);
        background: #fff;
        color: var(--rm-text);
        border-radius: 999px;
        padding: 7px 14px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 1px 3px rgba(0,0,0,0.12);
        white-space: nowrap;
        transition: background 0.15s, color 0.15s;
      }
      .rm-chip.active {
        background: var(--rm-accent);
        color: #fff;
        border-color: var(--rm-accent);
      }
      .rm-chip .rm-icon { margin-right: 4px; }

      .rm-lang-btn {
        flex: 0 0 auto;
        margin-left: auto;
        border: 1px solid var(--rm-border);
        background: #fff;
        border-radius: 999px;
        padding: 7px 12px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 1px 3px rgba(0,0,0,0.12);
      }

      .rm-search {
        pointer-events: auto;
        border: 1px solid var(--rm-border);
        background: #fff;
        border-radius: 12px;
        padding: 9px 12px;
        font-size: 14px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.12);
        width: 100%;
      }
      .rm-search:focus { outline: 2px solid var(--rm-accent); }

      .rm-pin {
        width: 34px;
        height: 34px;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        background: var(--pin-color, var(--rm-accent));
        border: 2px solid #fff;
        box-shadow: 0 2px 6px rgba(0,0,0,0.35);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }
      .rm-pin span {
        transform: rotate(45deg);
        font-size: 16px;
        line-height: 1;
      }
      .rm-pin img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; transform: rotate(45deg); }

      .rm-sheet {
        position: absolute;
        left: 0; right: 0; bottom: 0;
        z-index: 10;
        background: #fff;
        border-radius: 18px 18px 0 0;
        box-shadow: 0 -4px 20px rgba(0,0,0,0.25);
        max-height: 60%;
        overflow-y: auto;
        transform: translateY(100%);
        transition: transform 0.25s ease-out;
        padding: 14px 18px 24px;
      }
      .rm-sheet.open { transform: translateY(0); }
      .rm-sheet-close {
        position: absolute;
        top: 10px; right: 12px;
        border: none;
        background: #f1ece1;
        border-radius: 50%;
        width: 30px; height: 30px;
        font-size: 16px;
        cursor: pointer;
      }
      .rm-sheet img.rm-photo {
        width: 100%;
        max-height: 180px;
        object-fit: cover;
        border-radius: 12px;
        margin-bottom: 10px;
      }
      .rm-sheet h2 { margin: 0 0 4px; font-size: 18px; }
      .rm-sheet .rm-sub { font-size: 12px; color: #8a7a68; margin-bottom: 10px; }
      .rm-sheet p.rm-desc { font-size: 14px; line-height: 1.6; margin: 0 0 12px; }
      .rm-meta { font-size: 13px; margin-bottom: 6px; }
      .rm-meta b { display: block; font-size: 11px; color: #8a7a68; font-weight: 700; }
      .rm-links { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
      .rm-links a {
        font-size: 12px;
        color: var(--rm-accent);
        text-decoration: none;
        border: 1px solid var(--rm-accent);
        border-radius: 8px;
        padding: 5px 9px;
      }
      .rm-directions {
        display: block;
        width: 100%;
        margin-top: 10px;
        background: var(--rm-accent);
        color: #fff;
        border: none;
        border-radius: 10px;
        padding: 12px;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
      }

      .rm-empty-toast {
        position: absolute;
        bottom: 16px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0,0,0,0.75);
        color: #fff;
        padding: 8px 14px;
        border-radius: 999px;
        font-size: 12px;
        z-index: 8;
        display: none;
      }
      .rm-empty-toast.show { display: block; }

      @media (min-width: 768px) {
        .rm-sheet {
          left: auto;
          right: 16px;
          bottom: 16px;
          top: 90px;
          width: 340px;
          max-height: none;
          border-radius: 16px;
          transform: translateX(110%);
        }
        .rm-sheet.open { transform: translateX(0); }
      }
    </style>
    <div class="rm-root">
      <div class="rm-map"></div>
      <div class="rm-topbar">
        <div class="rm-row rm-areas"></div>
        <div class="rm-row">
          <input class="rm-search" type="search" />
          <button class="rm-lang-btn" type="button"></button>
        </div>
        <div class="rm-row rm-genres"></div>
      </div>
      <div class="rm-sheet">
        <button class="rm-sheet-close" type="button">&times;</button>
        <div class="rm-sheet-body"></div>
      </div>
      <div class="rm-empty-toast"></div>
    </div>
  `;

  class RegionMapElement extends HTMLElement {
    static get observedAttributes() {
      return ['lang', 'data-areas', 'data-shops', 'maptiler-key', 'map-style'];
    }

    constructor() {
      super();
      this._shadow = this.attachShadow({ mode: 'open' });
      this._shadow.innerHTML = TEMPLATE;

      this._map = null;
      this._markers = new Map(); // id -> { marker, shop }
      this._areas = [{ id: 'all', nameJa: '全エリア', nameEn: 'All Areas' }];
      this._shops = [];
      this._lang = 'ja';
      this._activeArea = 'all';
      this._activeGenres = new Set();
      this._searchTerm = '';
      this._mapReady = false;

      this._els = {
        map: this._shadow.querySelector('.rm-map'),
        areasRow: this._shadow.querySelector('.rm-areas'),
        genresRow: this._shadow.querySelector('.rm-genres'),
        search: this._shadow.querySelector('.rm-search'),
        langBtn: this._shadow.querySelector('.rm-lang-btn'),
        sheet: this._shadow.querySelector('.rm-sheet'),
        sheetBody: this._shadow.querySelector('.rm-sheet-body'),
        sheetClose: this._shadow.querySelector('.rm-sheet-close'),
        toast: this._shadow.querySelector('.rm-empty-toast'),
      };

      this._els.search.addEventListener('input', (e) => {
        this._searchTerm = e.target.value.trim().toLowerCase();
        this._applyFilters();
      });
      this._els.langBtn.addEventListener('click', () => {
        this.setLanguage(this._lang === 'ja' ? 'en' : 'ja');
      });
      this._els.sheetClose.addEventListener('click', () => this._closeDetail());
    }

    connectedCallback() {
      this._readAttributes();
      this._fixWixParentWidth();
      this._fixWixParentHeight();
      loadMapLibre()
        .then(() => this._initMap())
        .catch((err) => console.error('[region-map]', err));
    }

    // Wix Studio の「要素を自動的にドッキング」機能が、レスポンシブ計算の際に
    // この要素の直接の親 div へ余分な margin-right を残してしまうことがあり、
    // その結果マップの右側に余白ができてしまう。Wixの内部DOM構造は非公開/変更
    // され得るため、Velo側からは修正できない。Custom Element自身の
    // connectedCallback は通常のブラウザコンテキストで実行されるため、ここで
    // 直接の親要素の margin-right だけを都度リセットする。
    // また、セクションの「Max Width」設定（例: 1600px）により、それより広い
    // 画面では左右に均等な余白ができてしまうため、closest('section') までの
    // 祖先すべての max-width も解除し、画面幅いっぱいに広げる。
    _fixWixParentWidth() {
      const applyFix = () => {
        const parent = this.parentElement;
        if (parent && parent.style) {
          parent.style.setProperty('margin-right', '0px', 'important');
        }
        const section = this.closest('section');
        if (section) {
          let node = this.parentElement;
          while (node && node !== section) {
            node.style.setProperty('max-width', 'none', 'important');
            node.style.setProperty('width', '100%', 'important');
            node = node.parentElement;
          }
          section.style.setProperty('max-width', 'none', 'important');
        }
      };
      applyFix();
      setTimeout(applyFix, 300);
      setTimeout(applyFix, 1200);
      window.addEventListener('resize', applyFix);
    }

    // Wixエディタ側で、このセクションの高さが固定px値（エディタ上での見た目
    // の高さ）で保存されてしまうことがあり、実際の画面の高さより小さいと
    // 地図の下に余白ができてしまう。この要素を包む <section> を見つけ、
    // その上端から画面下端までの高さに動的に合わせることで、画面いっぱいに
    // 地図を表示する。間にある固定高さの中間div（Wixが自動生成するラッパー）
    // も height:100% に揃えないと、section だけ広げても反映されないため、
    // section に到達するまでの祖先要素すべてを対象にする。
    _fixWixParentHeight() {
      const applyFix = () => {
        const section = this.closest('section');
        if (!section) return;
        let node = this.parentElement;
        while (node && node !== section) {
          node.style.setProperty('height', '100%', 'important');
          node = node.parentElement;
        }
        const top = section.getBoundingClientRect().top;
        const available = Math.max(window.innerHeight - top, 300);
        section.style.setProperty('height', available + 'px', 'important');
        if (this._map) this._map.resize();
      };
      applyFix();
      setTimeout(applyFix, 300);
      setTimeout(applyFix, 1200);
      window.addEventListener('resize', applyFix);
    }

    attributeChangedCallback(name, oldVal, newVal) {
      if (oldVal === newVal) return;
      this._readAttribute(name);
      if (name === 'data-shops') this._applyFilters();
      if (name === 'data-areas') this._renderAreaTabs();
      if (name === 'lang') this._applyLanguage();
      if (name === 'map-style' && this._mapReady) this._applyStyle();
    }

    _readAttributes() {
      RegionMapElement.observedAttributes.forEach((n) => this._readAttribute(n));
    }

    _readAttribute(name) {
      const val = this.getAttribute(name);
      if (val == null) return;
      try {
        if (name === 'data-areas') {
          const parsed = JSON.parse(val);
          this._areas = [{ id: 'all', nameJa: '全エリア', nameEn: 'All Areas' }, ...parsed];
          this._renderAreaTabs();
        } else if (name === 'data-shops') {
          this._shops = JSON.parse(val);
        } else if (name === 'lang') {
          this._lang = val === 'en' ? 'en' : 'ja';
        }
      } catch (e) {
        console.error('[region-map] invalid JSON for', name, e);
      }
    }

    _t(key) {
      return STRINGS[this._lang][key];
    }

    // ---- Map ----
    _initMap() {
      const key = this.getAttribute('maptiler-key') || '';
      const styleName = this.getAttribute('map-style') || 'streets-v2';
      const styleUrl = key
        ? `https://api.maptiler.com/maps/${styleName}/style.json?key=${encodeURIComponent(key)}`
        : 'https://demotiles.maplibre.org/style.json';

      this._map = new window.maplibregl.Map({
        container: this._els.map,
        style: styleUrl,
        center: [139.767, 35.681],
        zoom: 12,
        attributionControl: true,
      });
      this._map.addControl(new window.maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

      this._map.on('load', () => {
        this._mapReady = true;
        this._renderAreaTabs();
        this._applyFilters();
        this._flyToArea(this._activeArea, true);
        this.dispatchEvent(new CustomEvent('ready', { bubbles: true, composed: true }));
      });

      this._observeResize();
    }

    // Wixはページのレイアウト計算（セクション幅の確定など）が、この要素が
    // 初期化された後に遅れて走ることがある。MapLibreは生成時のコンテナ
    // サイズでcanvasを確保するため、その後にコンテナが広がっても地図側が
    // 気づかず、読み込み時のサイズのまま小さく表示され続けてしまう。
    // ResizeObserverでコンテナの実サイズ変化を監視し、都度 map.resize() を
    // 呼んで地図のcanvasをその時点の実際のサイズに合わせ直す。
    _observeResize() {
      if (!window.ResizeObserver) return;
      const ro = new ResizeObserver(() => {
        if (this._map) this._map.resize();
      });
      ro.observe(this._els.map);
      this._resizeObserver = ro;
    }

    _applyStyle() {
      if (!this._map) return;
      const key = this.getAttribute('maptiler-key') || '';
      const styleName = this.getAttribute('map-style') || 'streets-v2';
      const styleUrl = key
        ? `https://api.maptiler.com/maps/${styleName}/style.json?key=${encodeURIComponent(key)}`
        : 'https://demotiles.maplibre.org/style.json';
      this._map.setStyle(styleUrl);
    }

    // ---- UI: Area tabs ----
    _renderAreaTabs() {
      const row = this._els.areasRow;
      row.innerHTML = '';
      this._areas.forEach((area) => {
        const btn = document.createElement('button');
        btn.className = 'rm-chip' + (area.id === this._activeArea ? ' active' : '');
        btn.type = 'button';
        btn.textContent = this._lang === 'en' ? (area.nameEn || area.nameJa) : area.nameJa;
        btn.addEventListener('click', () => {
          this._activeArea = area.id;
          this._renderAreaTabs();
          this._flyToArea(area.id);
          this._applyFilters();
        });
        row.appendChild(btn);
      });
    }

    _flyToArea(areaId, immediate) {
      if (!this._map) return;
      const area = this._areas.find((a) => a.id === areaId);
      if (!area) return;
      if (areaId === 'all') {
        if (this._shops.length === 0) return;
        const lngs = this._shops.map((s) => s.lng);
        const lats = this._shops.map((s) => s.lat);
        const bounds = [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ];
        this._map.fitBounds(bounds, { padding: 60, duration: immediate ? 0 : 1000, maxZoom: 15 });
      } else if (area.center) {
        this._map.flyTo({
          center: area.center,
          zoom: area.zoom || 15,
          duration: immediate ? 0 : 1200,
          essential: true,
        });
      }
    }

    // ---- UI: Genre chips ----
    _renderGenreChips() {
      const row = this._els.genresRow;
      row.innerHTML = '';
      GENRES.forEach((g) => {
        const btn = document.createElement('button');
        const active = this._activeGenres.has(g.id);
        btn.className = 'rm-chip' + (active ? ' active' : '');
        btn.type = 'button';
        btn.innerHTML = `<span class="rm-icon">${g.icon}</span>${this._lang === 'en' ? g.en : g.ja}`;
        btn.addEventListener('click', () => {
          if (this._activeGenres.has(g.id)) this._activeGenres.delete(g.id);
          else this._activeGenres.add(g.id);
          this._renderGenreChips();
          this._applyFilters();
        });
        row.appendChild(btn);
      });
    }

    // ---- Filtering & markers ----
    _applyLanguage() {
      this._els.search.placeholder = this._t('searchPlaceholder');
      this._els.langBtn.textContent = this._lang === 'ja' ? 'EN' : '日本語';
      this._renderAreaTabs();
      this._renderGenreChips();
      this._applyFilters();
    }

    _matchesFilters(shop) {
      if (this._activeArea !== 'all' && shop.area !== this._activeArea) return false;
      if (this._activeGenres.size > 0) {
        const shopGenres = shop.genres || [];
        const hasMatch = shopGenres.some((g) => this._activeGenres.has(g));
        if (!hasMatch) return false;
      }
      if (this._searchTerm) {
        const haystack = [shop.name, shop.nameEn, shop.address]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(this._searchTerm)) return false;
      }
      return true;
    }

    _applyFilters() {
      if (!this._mapReady) return;
      this._renderGenreChips();
      this._syncMarkers();
      const visibleCount = this._shops.filter((s) => this._matchesFilters(s)).length;
      if (visibleCount === 0 && this._shops.length > 0) {
        this._els.toast.textContent = this._t('noResults');
        this._els.toast.classList.add('show');
      } else {
        this._els.toast.classList.remove('show');
      }
    }

    _syncMarkers() {
      const seen = new Set();
      this._shops.forEach((shop) => {
        seen.add(shop.id);
        let entry = this._markers.get(shop.id);
        if (!entry) {
          const el = document.createElement('div');
          el.className = 'rm-pin';
          const genre = GENRES.find((g) => (shop.genres || [])[0] === g.id);
          el.style.setProperty('--pin-color', (genre && genre.color) || '#e8734a');
          if (shop.pinIcon) {
            el.innerHTML = `<img src="${shop.pinIcon}" alt="">`;
          } else {
            el.innerHTML = `<span>${(genre && genre.icon) || '📍'}</span>`;
          }
          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this._openDetail(shop);
          });
          const marker = new window.maplibregl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([shop.lng, shop.lat])
            .addTo(this._map);
          entry = { marker, shop };
          this._markers.set(shop.id, entry);
        } else {
          entry.shop = shop;
        }
        const visible = this._matchesFilters(shop);
        entry.marker.getElement().style.display = visible ? '' : 'none';
      });
      // remove markers for shops no longer present
      for (const [id, entry] of this._markers.entries()) {
        if (!seen.has(id)) {
          entry.marker.remove();
          this._markers.delete(id);
        }
      }
    }

    // ---- Detail sheet ----
    _openDetail(shop) {
      const lang = this._lang;
      const name = lang === 'en' && shop.nameEn ? shop.nameEn : shop.name;
      const desc = lang === 'en' ? shop.descriptionEn : shop.descriptionJa;
      const links = [];
      if (shop.url) links.push(`<a href="${shop.url}" target="_blank" rel="noopener">${this._t('website')}</a>`);
      (shop.sns || []).forEach((s) => {
        if (s && s.url) links.push(`<a href="${s.url}" target="_blank" rel="noopener">${s.label || this._t('website')}</a>`);
      });

      this._els.sheetBody.innerHTML = `
        ${shop.photo ? `<img class="rm-photo" src="${shop.photo}" alt="${name}">` : ''}
        <h2>${name}</h2>
        ${shop.address ? `<div class="rm-sub">${shop.address}</div>` : ''}
        ${desc ? `<p class="rm-desc">${desc}</p>` : ''}
        ${shop.hours ? `<div class="rm-meta"><b>${this._t('hours')}</b>${shop.hours}</div>` : ''}
        ${links.length ? `<div class="rm-links">${links.join('')}</div>` : ''}
        <button class="rm-directions" type="button">${this._t('directions')}</button>
      `;
      this._els.sheetBody.querySelector('.rm-directions').addEventListener('click', () => {
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${shop.lat},${shop.lng}`, '_blank');
      });
      this._els.sheet.classList.add('open');
      this.dispatchEvent(new CustomEvent('shopselected', { detail: { id: shop.id }, bubbles: true, composed: true }));
    }

    _closeDetail() {
      this._els.sheet.classList.remove('open');
    }

    // ---- Public API (also reachable via setAttribute from Velo) ----
    setLanguage(lang) {
      this.setAttribute('lang', lang === 'en' ? 'en' : 'ja');
    }
    setShops(shops) {
      this.setAttribute('data-shops', JSON.stringify(shops));
    }
    setAreas(areas) {
      this.setAttribute('data-areas', JSON.stringify(areas));
    }
    flyToArea(areaId) {
      this._activeArea = areaId;
      this._renderAreaTabs();
      this._flyToArea(areaId);
      this._applyFilters();
    }
  }

  customElements.define('region-map', RegionMapElement);
})();
