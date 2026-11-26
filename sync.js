// Cloud-Sync mit Firebase (Auth + Firestore). Die App funktioniert ohne das hier komplett lokal;
// dieser Teil gleicht nur ab, sobald ein Konto angemeldet und Netz da ist.
// Datenmodell: users/{uid}/entries/{entryId}, users/{uid}/meta/settings — Last-Write-Wins über updatedAt.
import { firebaseConfig } from './firebase-config.js';

const V = '11.0.2';
const $ = s => document.querySelector(s);
const status = t => { $('#syncstatus').textContent = t; };
const Store = window.SportStore;
// Firestore kann keine Arrays in Arrays speichern (Schnell-Buttons sind [[KZ, LS, Runden], ...]),
// darum werden die Presets als Text gespeichert und beim Laden zurückverwandelt.
const settingsOut = s => ({ ...s, presets: JSON.stringify(s.presets || []) });
const settingsIn = s => { try { return { ...s, presets: typeof s.presets === 'string' ? JSON.parse(s.presets) : s.presets }; } catch { const { presets, ...rest } = s; return rest; } };

if (!firebaseConfig) {
  status('Sync ist noch nicht eingerichtet. Deine Daten bleiben auf diesem Gerät.');
} else {
  start().catch(e => { console.warn('sync', e); status(navigator.onLine ? 'Sync konnte nicht starten: ' + e.message : 'Offline – Sync startet, sobald du wieder online bist.'); });
}

async function start() {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  const fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });

  let user = null, unsub = [], pushing = false, again = false;

  const show = () => {
    $('#login').hidden = !!user; $('#loggedin').hidden = !user;
    if (!user) status('Nicht angemeldet. Melde dich an, um deine Daten auf allen Geräten zu haben.');
  };

  async function push() {
    if (!user) return;
    if (pushing) { again = true; return; }
    pushing = true;
    try {
      do {
        again = false;
        const { entries, settings } = Store.pending();
        if (!entries.length && !settings) break;
        status(`Synchronisiere ${entries.length} Änderung(en) …`);
        for (let i = 0; i < entries.length || (i === 0 && settings); i += 400) {
          const chunk = entries.slice(i, i + 400);
          const b = F.writeBatch(fs);
          for (const e of chunk) b.set(F.doc(fs, 'users', user.uid, 'entries', e.id), e);
          const s = i === 0 ? settings : null;
          if (s) b.set(F.doc(fs, 'users', user.uid, 'meta', 'settings'), settingsOut(s));
          await b.commit(); // wartet offline, bis der Server bestätigt
          Store.markSynced(chunk.map(e => [e.id, e.updatedAt]), s ? s.updatedAt : null);
          if (!entries.length) break;
        }
      } while (again);
      status(`Synchronisiert als ${user.email || 'Google-Konto'} · ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`);
    } catch (e) {
      console.warn('push', e); status('Sync-Fehler: ' + e.message);
    } finally { pushing = false; }
  }

  A.onAuthStateChanged(auth, u => {
    unsub.forEach(f => f()); unsub = [];
    user = u; show();
    if (!u) return;
    status('Angemeldet, lade Daten …');
    unsub.push(F.onSnapshot(F.collection(fs, 'users', u.uid, 'entries'), snap => {
      Store.mergeRemote({ entries: snap.docChanges().map(c => c.doc.data()) });
      push();
    }, e => status('Sync-Fehler: ' + e.message)));
    unsub.push(F.onSnapshot(F.doc(fs, 'users', u.uid, 'meta', 'settings'), d => {
      if (d.exists()) Store.mergeRemote({ settings: settingsIn(d.data()) });
    }, () => {}));
  });

  addEventListener('data-changed', () => push());
  addEventListener('online', () => push());

  $('#google').addEventListener('click', async () => {
    const p = new A.GoogleAuthProvider();
    try { await A.signInWithPopup(auth, p); }
    catch (e) {
      if (/popup/.test(e.code || '')) await A.signInWithRedirect(auth, p);
      else Store.toast('Anmeldung fehlgeschlagen: ' + (e.code || e.message));
    }
  });
  $('#login').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target, mode = ev.submitter?.value;
    try {
      if (mode === 'signup') await A.createUserWithEmailAndPassword(auth, f.email.value, f.password.value);
      else await A.signInWithEmailAndPassword(auth, f.email.value, f.password.value);
      f.password.value = '';
    } catch (e) { Store.toast('Anmeldung fehlgeschlagen: ' + (e.code || e.message).replace('auth/', '')); }
  });
  $('#logout').addEventListener('click', () => A.signOut(auth));
  $('#syncnow').addEventListener('click', () => push());
  show();
}
