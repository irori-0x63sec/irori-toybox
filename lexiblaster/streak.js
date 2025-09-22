(function(){
  const STORAGE_KEY = 'lb_profile_v2';
  const DB_NAME = 'lb_backup';
  const DB_STORE = 'profiles';

  const defaultStreak = () => ({ current: 0, best: 0, lastPlayed: null });
  const defaultProfile = () => ({ version: 2, updatedAt: 0, streak: defaultStreak() });

  let memoryProfile = null;
  let dbPromise = null;

  function canUseStorage(){
    try {
      if (window.lexiConsent && typeof window.lexiConsent.allow === 'function') {
        return !!window.lexiConsent.allow('storage');
      }
    } catch {}
    return true;
  }

  function clone(obj){
    try { return JSON.parse(JSON.stringify(obj)); }
    catch { return defaultProfile(); }
  }

  function ensureStreakShape(raw){
    const base = defaultStreak();
    if (!raw || typeof raw !== 'object') return base;
    const current = Number.isFinite(Number(raw.current)) ? Math.max(0, Math.floor(Number(raw.current))) : 0;
    const bestRaw = Number.isFinite(Number(raw.best)) ? Math.max(0, Math.floor(Number(raw.best))) : 0;
    const best = Math.max(current, bestRaw);
    const lastPlayed = (typeof raw.lastPlayed === 'string' && raw.lastPlayed) ? raw.lastPlayed : null;
    return { current, best, lastPlayed };
  }

  function ensureProfileShape(raw){
    const base = defaultProfile();
    if (!raw || typeof raw !== 'object') return clone(base);
    const out = clone({ ...raw });
    out.version = 2;
    out.updatedAt = (typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)) ? raw.updatedAt : Date.now();
    out.streak = ensureStreakShape(raw.streak);
    return out;
  }

  function getTokyoDateString(ts = Date.now()){
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(ts);
    } catch {
      const d = new Date(ts);
      const utc = d.getTime() + d.getTimezoneOffset() * 60000;
      const tokyo = new Date(utc + 9 * 60 * 60000);
      const y = tokyo.getUTCFullYear();
      const m = String(tokyo.getUTCMonth() + 1).padStart(2, '0');
      const day = String(tokyo.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
  }

  function parseTokyoDate(str){
    if (!str) return null;
    const iso = `${str}T00:00:00+09:00`;
    const time = Date.parse(iso);
    return Number.isFinite(time) ? time : null;
  }

  function dayDiffTokyo(prev, current){
    const prevTime = parseTokyoDate(prev);
    const currTime = parseTokyoDate(current);
    if (prevTime == null || currTime == null) return null;
    const diff = Math.round((currTime - prevTime) / 86400000);
    return diff;
  }

  function openDB(){
    if (!('indexedDB' in window)) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      let resolved = false;
      try {
        const req = window.indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function(event){
          const db = event.target.result;
          if (!db.objectStoreNames.contains(DB_STORE)) {
            db.createObjectStore(DB_STORE);
          }
        };
        req.onsuccess = function(){
          const db = req.result;
          db.onversionchange = () => { try { db.close(); } catch {} };
          resolve(db);
          resolved = true;
        };
        req.onerror = function(){ resolved = true; resolve(null); };
      } catch {
        resolve(null);
        resolved = true;
      }
      setTimeout(() => { if (!resolved) resolve(null); }, 4000);
    });
    return dbPromise;
  }

  async function idbGet(key){
    try {
      const db = await openDB();
      if (!db) return null;
      return await new Promise((resolve) => {
        try {
          const tx = db.transaction(DB_STORE, 'readonly');
          const store = tx.objectStore(DB_STORE);
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    } catch {
      return null;
    }
  }

  async function idbPut(key, value){
    try {
      const db = await openDB();
      if (!db) return;
      await new Promise((resolve) => {
        try {
          const tx = db.transaction(DB_STORE, 'readwrite');
          const store = tx.objectStore(DB_STORE);
          const req = store.put(value, key);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    } catch {}
  }

  function loadFromLocal(){
    if (!canUseStorage()) return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async function loadFromIDB(){
    if (!canUseStorage()) return null;
    return await idbGet(STORAGE_KEY);
  }

  async function saveToLocal(profile){
    if (!canUseStorage()) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch {}
  }

  async function saveToIDB(profile){
    if (!canUseStorage()) return;
    await idbPut(STORAGE_KEY, profile);
  }

  const LBBackup = {
    async load(){
      if (memoryProfile) return clone(memoryProfile);
      let profile = loadFromLocal();
      if (!profile) profile = await loadFromIDB();
      if (!profile) profile = defaultProfile();
      profile = ensureProfileShape(profile);
      memoryProfile = profile;
      return clone(memoryProfile);
    },
    async save(data){
      const shaped = ensureProfileShape(data);
      shaped.updatedAt = Date.now();
      memoryProfile = shaped;
      await Promise.all([
        saveToLocal(shaped),
        saveToIDB(shaped)
      ]);
      return clone(memoryProfile);
    }
  };

  async function getStreak(){
    const profile = await LBBackup.load();
    return ensureStreakShape(profile.streak);
  }

  async function markPlayedToday(){
    const profile = await LBBackup.load();
    const streak = ensureStreakShape(profile.streak);
    const today = getTokyoDateString();
    if (streak.lastPlayed === today) {
      return streak;
    }

    const gap = dayDiffTokyo(streak.lastPlayed, today);
    if (gap === 1) {
      streak.current = Math.max(0, (streak.current || 0) + 1);
    } else {
      streak.current = 1;
    }
    streak.best = Math.max(streak.best || 0, streak.current);
    streak.lastPlayed = today;

    profile.streak = streak;
    const saved = await LBBackup.save(profile);
    return ensureStreakShape(saved.streak);
  }

  window.LBBackup = LBBackup;
  window.LBStreak = { getStreak, markPlayedToday };
})();
