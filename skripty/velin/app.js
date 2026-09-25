// 3D Velín. Každých 10 s čte /api/stav a kreslí tým jako scénu: manažer uprostřed, týmy na
// šestiúhelníkových plošinách, paprsky od toho, kdo agenta spustil, PR jako krystaly kolem jádra,
// úkoly jako karty na oblouku a noční směnu jako měsíc. Tlačítka posílají akce na /api/akce
// s klíčem z odkazu při spuštění. Text z GitHubu jde do stránky jen přes textContent
// a do scény jen jako kreslený text na plátně.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const OBNOVA_MS = 10_000;
const STAVY = [
  ['stav:napad', 'Nápad'], ['stav:pripraveno', 'Připraveno'], ['stav:rozpracovano', 'Rozpracováno'],
  ['stav:revize', 'V revizi'], ['stav:ceka-na-vlastnika', 'Čeká na vlastníka'],
];
const BARVY_TYMU = {
  Produkt: 0xff6bd6, Vývoj: 0x4cc9ff, Kvalita: 0x3dffa8, Provoz: 0xffb547, Marketing: 0xff7a59,
  Objevování: 0xb68cff, Revize: 0xff4d6d, Právo: 0xffd76a, Platforma: 0x5cf2ff,
};
const BARVY_SLOUPCU = {
  'stav:napad': '#b68cff', 'stav:pripraveno': '#4cc9ff', 'stav:rozpracovano': '#ffb547',
  'stav:revize': '#5cf2ff', 'stav:ceka-na-vlastnika': '#ffd76a', blokovano: '#ff4d6d',
};
const BARVY_PR = { ok: 0x3dffa8, chyba: 0xff4d6d, bezi: 0xffb547, nezname: 0x8ea3c7 };
const JADRO = new THREE.Vector3(0, 4, 0);
const VYCHOZI_CIL = new THREE.Vector3(0, 5, 0);
const POLOMER_TYMU = 17;
const POLOMER_TABULE = 34;
const MAX_KARET = 6;
const POHLED_TABULE = { cil: new THREE.Vector3(0, 10.5, -POLOMER_TABULE), kamera: new THREE.Vector3(0, 12, -4) };

const $ = (id) => document.getElementById(id);
const pomalu = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- klíč a akce ----------

// Klíč přichází jen ve fragmentu odkazu (server ho nikdy neposílá). Z adresního řádku zmizí
// a do zavření karty zůstane v sessionStorage, aby fungovala obnova stránky.
function nactiKlic() {
  const zOdkazu = new URLSearchParams(location.hash.slice(1)).get('klic');
  if (zOdkazu) history.replaceState(null, '', location.pathname);
  try {
    if (zOdkazu) sessionStorage.setItem('velin-klic', zOdkazu);
    return zOdkazu || sessionStorage.getItem('velin-klic');
  } catch {
    return zOdkazu;
  }
}
let klic = nactiKlic();

function zrusKlic() {
  klic = null;
  try {
    sessionStorage.removeItem('velin-klic');
  } catch {}
  ukazOvladani();
}

function ukazOvladani() {
  const s = $('ovladani');
  s.textContent = klic ? 'ovládání zapnuto' : 'jen prohlížení';
  s.className = `stitek ${klic ? 'ok' : ''}`;
  s.title = klic ? 'Tlačítka mění štítky na GitHubu pod tvým účtem.' : 'Pro tlačítka otevři Velín odkazem, který vypsal `npm run velin` v tvém terminálu.';
  $('b-novy').disabled = !klic;
  $('b-noc').disabled = !klic;
}

const jeNoc = () => {
  const h = new Date().getHours();
  return h >= 22 || h < 7;
};
const HLIDAC = '\n\nJe mezi 22:00 a 7:00: noční hlídač to nahlásí jako noční akci. Když jsi to byl ty, upozornění zavři.';

async function akce(data, tlacitko) {
  if (!klic) return toast('Jen prohlížení. Otevři Velín odkazem z terminálu.', 'chyba');
  if (tlacitko) tlacitko.disabled = true;
  try {
    const odpoved = await fetch('/api/akce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Velin-Klic': klic },
      body: JSON.stringify(data),
    });
    const vysledek = await odpoved.json().catch(() => ({}));
    if (!odpoved.ok) {
      if (odpoved.status === 403 && /klíč/.test(vysledek.chyba ?? '')) zrusKlic();
      throw new Error(vysledek.chyba || `Chyba ${odpoved.status}`);
    }
    toast(vysledek.zprava ?? 'Hotovo.', 'ok');
    await obnov();
    return true;
  } catch (chyba) {
    toast(chyba.message, 'chyba');
    return false;
  } finally {
    if (tlacitko) tlacitko.disabled = false;
  }
}

// ---------- DOM ----------

function el(tag, trida, text) {
  const x = document.createElement(tag);
  if (trida) x.className = trida;
  if (text !== undefined && text !== null) x.textContent = String(text);
  return x;
}

function tlacitko(text, pri, trida = '') {
  const b = el('button', trida, text);
  b.type = 'button';
  b.addEventListener('click', () => pri(b));
  return b;
}

function odkaz(text, url) {
  const a = el('a', 'tlacitko', text);
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function toast(text, druh = '') {
  const t = el('div', `toast ${druh}`, text);
  $('toasty').append(t);
  setTimeout(() => t.remove(), druh === 'chyba' ? 9000 : 5000);
}

function pred(cas) {
  const t = typeof cas === 'number' ? cas : Date.parse(cas);
  if (!Number.isFinite(t)) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'před chvílí';
  if (s < 3600) return `před ${Math.round(s / 60)} min`;
  if (s < 86400) return `před ${Math.round(s / 3600)} h`;
  return `před ${Math.round(s / 86400)} d`;
}

const repoOk = (r) => typeof r === 'string' && /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(r);
const urlGitHub = (druh, n) => (repoOk(stav?.repo) ? `https://github.com/${stav.repo}/${druh}/${Number(n)}` : null);

function stavKontrol(k) {
  const v = Object.values(k ?? {});
  if (!v.length) return 'nezname';
  if (v.some((x) => ['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure'].includes(x))) return 'chyba';
  if (v.every((x) => ['success', 'neutral', 'skipped'].includes(x))) return 'ok';
  return 'bezi';
}

// ---------- 3D základ ----------

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: $('scena'), antialias: true, powerPreference: 'high-performance' });
} catch {
  $('bez-3d').hidden = false;
}

const scena = new THREE.Scene();
scena.background = new THREE.Color(0x02040b);
scena.fog = new THREE.FogExp2(0x02040b, 0.0105);
const kamera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1200);
kamera.position.set(0, 27, 47);

let ovladani;
let skladac;
let bloom;
if (renderer) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  ovladani = new OrbitControls(kamera, renderer.domElement);
  ovladani.target.copy(VYCHOZI_CIL);
  ovladani.enableDamping = true;
  ovladani.dampingFactor = 0.06;
  ovladani.autoRotate = !pomalu;
  ovladani.autoRotateSpeed = 0.35;
  ovladani.maxPolarAngle = 1.45;
  ovladani.minDistance = 10;
  ovladani.maxDistance = 130;
  skladac = new EffectComposer(renderer);
  skladac.addPass(new RenderPass(scena, kamera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 1.15, 0.6, 0.85);
  skladac.addPass(bloom);
  skladac.addPass(new OutputPass());
}

addEventListener('resize', () => {
  if (!renderer) return;
  kamera.aspect = innerWidth / innerHeight;
  kamera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  skladac.setSize(innerWidth, innerHeight);
});

// Barva se září: hodnoty nad 1 projdou prahem bloomu, běžný text a karty ne.
const zari = (barva, sila) => new THREE.Color(barva).multiplyScalar(sila);

function uvolni(objekt) {
  objekt.traverse((o) => {
    if (o.geometry && !o.geometry.userData.sdilena) o.geometry.dispose();
    for (const m of [o.material].flat()) {
      if (!m || m.userData.sdileny) continue;
      if (m.map && !m.map.userData.sdilena) m.map.dispose();
      m.dispose();
    }
  });
  objekt.removeFromParent();
}

function sdilena(geometrie) {
  geometrie.userData.sdilena = true;
  return geometrie;
}

function texturaZare() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const p = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  p.addColorStop(0, 'rgba(255,255,255,1)');
  p.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  p.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = p;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.userData.sdilena = true;
  return t;
}
const ZARE = texturaZare();

function svatozar(barva, velikost, sila = 1) {
  const m = new THREE.SpriteMaterial({ map: ZARE, color: zari(barva, sila), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const s = new THREE.Sprite(m);
  s.scale.setScalar(velikost);
  return s;
}

function textovySprite(text, { barva = '#dfeaff', velikost = 44, vyska = 1, vaha = 600 } = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const pismo = `${vaha} ${velikost}px "Segoe UI", system-ui, sans-serif`;
  g.font = pismo;
  c.width = Math.ceil(g.measureText(text).width + velikost);
  c.height = Math.ceil(velikost * 1.6);
  g.font = pismo;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = barva;
  g.shadowBlur = velikost * 0.3;
  g.fillStyle = barva;
  g.fillText(text, c.width / 2, c.height / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set((vyska * c.width) / c.height, vyska, 1);
  return s;
}

// ---------- statická scéna ----------

scena.add(new THREE.AmbientLight(0x3a5580, 1.1));
scena.add(new THREE.HemisphereLight(0x6fb7ff, 0x080410, 0.8));
const svetloJadra = new THREE.PointLight(0x4cc9ff, 220, 70, 1.6);
svetloJadra.position.copy(JADRO);
scena.add(svetloJadra);

// podlaha: tmavý lesklý disk, polární mřížka a zářící prstenec týmů
const podlaha = new THREE.Mesh(
  new THREE.CircleGeometry(90, 96),
  new THREE.MeshStandardMaterial({ color: 0x050b1a, metalness: 0.85, roughness: 0.45 }),
);
podlaha.rotation.x = -Math.PI / 2;
podlaha.position.y = -0.05;
scena.add(podlaha);
const mrizka = new THREE.PolarGridHelper(60, 24, 10, 96, 0x1d4f8a, 0x0e2748);
mrizka.material.transparent = true;
mrizka.material.opacity = 0.45;
scena.add(mrizka);
for (const [r, sila, sirka] of [[POLOMER_TYMU, 1.6, 0.06], [POLOMER_TYMU + 6.5, 0.8, 0.03], [8.5, 1.2, 0.04]]) {
  const prsten = new THREE.Mesh(
    new THREE.RingGeometry(r - sirka, r + sirka, 160),
    new THREE.MeshBasicMaterial({ color: zari(0x4cc9ff, sila), transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
  );
  prsten.rotation.x = -Math.PI / 2;
  prsten.position.y = 0.01;
  scena.add(prsten);
}

// hvězdy
const hvezdy = (() => {
  const n = 2200;
  const pole = new Float32Array(n * 3);
  const barvy = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const r = 220 + Math.random() * 260;
    const u = Math.random() * Math.PI * 2;
    const v = Math.acos(2 * Math.random() - 1);
    pole.set([r * Math.sin(v) * Math.cos(u), Math.abs(r * Math.cos(v)) * 0.9 - 20, r * Math.sin(v) * Math.sin(u)], i * 3);
    c.setHSL(0.55 + Math.random() * 0.15, 0.6, 0.6 + Math.random() * 0.4);
    barvy.set([c.r, c.g, c.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pole, 3));
  g.setAttribute('color', new THREE.BufferAttribute(barvy, 3));
  const body = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.4, vertexColors: true, transparent: true, opacity: 0.85, fog: false, depthWrite: false }));
  scena.add(body);
  return body;
})();

// jádro = manažer
const jadro = new THREE.Group();
jadro.position.copy(JADRO);
scena.add(jadro);
const jadroKoule = new THREE.Mesh(new THREE.SphereGeometry(1.35, 48, 48), new THREE.MeshBasicMaterial({ color: zari(0x9be7ff, 2.4) }));
jadroKoule.userData.cil = { druh: 'manazer' };
jadro.add(jadroKoule);
const jadroSit = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(2.5, 1)),
  new THREE.LineBasicMaterial({ color: zari(0x4cc9ff, 1.8), transparent: true, opacity: 0.8 }),
);
jadro.add(jadroSit);
const jadroPrstence = [0, 1, 2].map((i) => {
  const p = new THREE.Mesh(new THREE.TorusGeometry(3.3 + i * 0.5, 0.035, 8, 128), new THREE.MeshBasicMaterial({ color: zari(i === 1 ? 0xb68cff : 0x4cc9ff, 1.7) }));
  p.rotation.set(Math.PI / 2 + i * 0.5, i * 0.7, 0);
  jadro.add(p);
  return p;
});
jadro.add(svatozar(0x4cc9ff, 11, 0.9));
const stitekJadra = textovySprite('MANAŽER', { barva: '#9be7ff', vyska: 1.1 });
stitekJadra.position.y = 4.6;
jadro.add(stitekJadra);

// měsíc = noční směna
function texturaMesice() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#c9d3ee';
  g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 160; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 256;
    const r = 2 + Math.random() ** 3 * 26;
    g.fillStyle = `rgba(90,105,150,${0.12 + Math.random() * 0.25})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const mesic = new THREE.Group();
mesic.position.set(30, 17, -4);
scena.add(mesic);
const mesicMaterial = new THREE.MeshStandardMaterial({ map: texturaMesice(), emissive: 0x7da2ff, emissiveIntensity: 0.55, roughness: 1 });
const mesicKoule = new THREE.Mesh(new THREE.SphereGeometry(2.4, 64, 64), mesicMaterial);
mesicKoule.userData.cil = { druh: 'noc' };
mesic.add(mesicKoule);
const mesicZare = svatozar(0x7da2ff, 9, 0.8);
mesic.add(mesicZare);
let stitekMesice = null;
const satelity = new THREE.Group();
mesic.add(satelity);

// ---------- dynamická scéna ----------

const tymyScena = new THREE.Group();
const paprsky = new THREE.Group();
const krystaly = new THREE.Group();
const tabule = new THREE.Group();
scena.add(tymyScena, paprsky, krystaly, tabule);

const GEO_CLEN = sdilena(new THREE.SphereGeometry(0.55, 32, 32));
const GEO_VEDOUCI = sdilena(new THREE.SphereGeometry(0.9, 40, 40));
const GEO_KRYSTAL = sdilena(new THREE.OctahedronGeometry(0.75, 0));
const GEO_KARTA = sdilena(new THREE.PlaneGeometry(8.1, 2.53));
const GEO_CASTICE = sdilena(new THREE.SphereGeometry(0.12, 12, 12));
const GEO_VESTAVENY = sdilena(new THREE.IcosahedronGeometry(0.5, 0));

let stav = null;
let podpisTymu = '';
const agenti = new Map(); // jmeno → { mesh, zare, paprsek, tym, barva, pozice }
const platformy = []; // { hrany, sloup, clenove }
let castice = [];
let krystalyAnim = [];
let klikaci = [];
let vestaveni = new Map();

function postavTymy(tymy) {
  for (const d of [...tymyScena.children]) uvolni(d);
  agenti.clear();
  platformy.length = 0;
  tymy.forEach((tym, i) => {
    const uhel = (i / tymy.length) * Math.PI * 2 + Math.PI / 2;
    const barva = BARVY_TYMU[tym.nazev] ?? 0x8ea3c7;
    const skupina = new THREE.Group();
    skupina.position.set(Math.cos(uhel) * POLOMER_TYMU, 0, Math.sin(uhel) * POLOMER_TYMU);
    skupina.rotation.y = -uhel + Math.PI / 2;
    tymyScena.add(skupina);

    const geo = new THREE.CylinderGeometry(4.3, 4.7, 0.5, 6);
    const deska = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x0a1630, metalness: 0.75, roughness: 0.32, emissive: barva, emissiveIntensity: 0.05 }));
    deska.position.y = 0.25;
    skupina.add(deska);
    const hrany = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: zari(barva, 1.4), transparent: true, opacity: 0.55 }));
    hrany.position.y = 0.25;
    skupina.add(hrany);
    const sloup = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 4.2, 9, 6, 1, true),
      new THREE.MeshBasicMaterial({ color: barva, transparent: true, opacity: 0.015, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    sloup.position.y = 5;
    skupina.add(sloup);
    const nazev = textovySprite(tym.nazev.toUpperCase(), { barva: `#${new THREE.Color(barva).getHexString()}`, vyska: 1.05 });
    nazev.position.y = 5.6;
    skupina.add(nazev);

    const clenove = tym.clenove.filter((c) => c.jmeno !== tym.vedouci);
    const vedouci = tym.clenove.find((c) => c.jmeno === tym.vedouci);
    const umisti = (agent, pozice, vedouciAgent) => {
      const m = new THREE.Mesh(vedouciAgent ? GEO_VEDOUCI : GEO_CLEN, new THREE.MeshStandardMaterial({
        color: 0x0d1a33, emissive: barva, emissiveIntensity: 0.35, metalness: 0.3, roughness: 0.25,
      }));
      m.position.copy(pozice);
      m.userData.cil = { druh: 'agent', id: agent.jmeno };
      skupina.add(m);
      const z = svatozar(barva, vedouciAgent ? 4.2 : 3, 1.6);
      z.position.copy(pozice);
      z.visible = false;
      skupina.add(z);
      const paprsek = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 14, 6, 1, true),
        new THREE.MeshBasicMaterial({ color: zari(barva, 2.2), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      paprsek.position.set(pozice.x, pozice.y + 7, pozice.z);
      paprsek.visible = false;
      skupina.add(paprsek);
      agenti.set(agent.jmeno, { mesh: m, zare: z, paprsek, tym: tym.nazev, barva, vedouci: vedouciAgent, faze: Math.random() * 6 });
    };
    if (vedouci) umisti(vedouci, new THREE.Vector3(0, 1.55, 0), true);
    clenove.forEach((c, j) => {
      const a = (j / Math.max(clenove.length, 1)) * Math.PI * 2;
      umisti(c, new THREE.Vector3(Math.cos(a) * 2.7, 1.05, Math.sin(a) * 2.7), false);
    });
    platformy.push({ hrany, sloup, deska, clenove: tym.clenove.map((c) => c.jmeno) });

    // řetěz velení: slabý oblouk od jádra k vedoucímu
    if (vedouci) {
      skupina.updateMatrixWorld(true);
      const cil = skupina.localToWorld(new THREE.Vector3(0, 1.55, 0));
      const stred = JADRO.clone().lerp(cil, 0.5).setY(6.5);
      const krivka = new THREE.QuadraticBezierCurve3(JADRO.clone(), stred, cil);
      const cara = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(krivka.getPoints(40)),
        new THREE.LineBasicMaterial({ color: barva, transparent: true, opacity: 0.16 }),
      );
      tymyScena.add(cara);
    }
  });
  tymyScena.updateMatrixWorld(true);
  for (const a of agenti.values()) a.pozice = a.mesh.getWorldPosition(new THREE.Vector3());
}

function poziceAgenta(jmeno) {
  if (agenti.has(jmeno)) return agenti.get(jmeno).pozice;
  // vestavění agenti (Explore, Plan…) obíhají blízko jádra
  if (!vestaveni.has(jmeno)) {
    const i = vestaveni.size;
    const a = i * 2.4;
    vestaveni.set(jmeno, new THREE.Vector3(Math.cos(a) * 6, 1.4 + (i % 3) * 0.6, Math.sin(a) * 6));
  }
  return vestaveni.get(jmeno);
}

function postavPaprsky() {
  for (const d of [...paprsky.children]) uvolni(d);
  castice = [];
  vestaveni = new Map();
  for (const b of stav.bezi) {
    const do_ = poziceAgenta(b.typ);
    if (!agenti.has(b.typ)) {
      const orb = new THREE.Mesh(GEO_VESTAVENY, new THREE.MeshBasicMaterial({ color: zari(0xdfeaff, 1.8), wireframe: true }));
      orb.position.copy(do_);
      orb.userData.cil = { druh: 'beh', id: b.id };
      paprsky.add(orb);
    }
    const od = b.spustil && b.spustil !== 'manažer' && agenti.has(b.spustil) ? agenti.get(b.spustil).pozice : JADRO;
    const barva = b.mimoRetez ? 0xff4d6d : agenti.get(b.typ)?.barva ?? 0xdfeaff;
    const stred = od.clone().lerp(do_, 0.5);
    stred.y += 4 + od.distanceTo(do_) * 0.15;
    const krivka = new THREE.QuadraticBezierCurve3(od.clone(), stred, do_.clone());
    const trubka = new THREE.Mesh(
      new THREE.TubeGeometry(krivka, 64, 0.045, 6, false),
      new THREE.MeshBasicMaterial({ color: zari(barva, 1.6), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    paprsky.add(trubka);
    const material = new THREE.MeshBasicMaterial({ color: zari(barva, 4) });
    for (let k = 0; k < 7; k++) {
      const c = new THREE.Mesh(GEO_CASTICE, material);
      paprsky.add(c);
      castice.push({ mesh: c, krivka, posun: k / 7 });
    }
  }
}

function postavKrystaly() {
  for (const d of [...krystaly.children]) uvolni(d);
  krystalyAnim = [];
  const pr = stav.github?.pr ?? [];
  pr.forEach((p, i) => {
    const druh = stavKontrol(p.kontroly);
    const barva = BARVY_PR[druh];
    const skupina = new THREE.Group();
    const m = new THREE.Mesh(GEO_KRYSTAL, new THREE.MeshStandardMaterial({
      color: barva, emissive: barva, emissiveIntensity: druh === 'nezname' ? 0.4 : 1.6, metalness: 0.2, roughness: 0.1, flatShading: true,
    }));
    m.userData.cil = { druh: 'pr', id: p.cislo };
    skupina.add(m);
    skupina.add(svatozar(barva, 3.4, 0.9));
    const schvaleny = p.stitky.includes('schvaleno-vlastnikem');
    if (schvaleny) {
      const prsten = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.04, 8, 64), new THREE.MeshBasicMaterial({ color: zari(0xffd76a, 2.5) }));
      prsten.rotation.x = Math.PI / 2;
      skupina.add(prsten);
    }
    const s = textovySprite(`#${p.cislo}`, { barva: schvaleny ? '#ffd76a' : '#dfeaff', vyska: 0.75 });
    s.position.y = 1.5;
    skupina.add(s);
    krystaly.add(skupina);
    const cekaNaMe = stav.github.proVlastnika.pr.some((x) => x.cislo === p.cislo);
    krystalyAnim.push({ skupina, mesh: m, uhel: (i / pr.length) * Math.PI * 2, cekaNaMe });
  });
}

function zalomText(g, text, sirka, radku) {
  const slova = text.split(/\s+/);
  const vysledek = [];
  let radek = '';
  for (const slovo of slova) {
    const zkus = radek ? `${radek} ${slovo}` : slovo;
    if (g.measureText(zkus).width <= sirka) radek = zkus;
    else {
      if (radek) vysledek.push(radek);
      radek = slovo;
    }
    if (vysledek.length === radku) break;
  }
  if (vysledek.length < radku && radek) vysledek.push(radek);
  if (vysledek.length === radku && slova.join(' ') !== vysledek.join(' ')) {
    let posledni = vysledek[radku - 1];
    while (posledni.length && g.measureText(`${posledni}…`).width > sirka) posledni = posledni.slice(0, -1);
    vysledek[radku - 1] = `${posledni}…`;
  }
  return vysledek;
}

function texturaKarty(issue, barva) {
  const W = 640;
  const H = 200;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(8,16,38,0.9)';
  g.beginPath();
  g.roundRect(3, 3, W - 6, H - 6, 22);
  g.fill();
  g.strokeStyle = barva;
  g.lineWidth = 3;
  g.globalAlpha = 0.7;
  g.stroke();
  g.globalAlpha = 1;
  g.fillStyle = barva;
  g.beginPath();
  g.roundRect(3, 3, 12, H - 6, [22, 0, 0, 22]);
  g.fill();
  g.font = '600 38px "Segoe UI", system-ui, sans-serif';
  g.fillStyle = '#ffd76a';
  g.textBaseline = 'alphabetic';
  g.fillText(`#${issue.cislo}`, 36, 52);
  g.font = '500 32px "Segoe UI", system-ui, sans-serif';
  g.fillStyle = '#dfeaff';
  zalomText(g, issue.nazev, W - 70, 2).forEach((r, i) => g.fillText(r, 36, 98 + i * 38));
  const znacky = [];
  if (issue.stitky.includes('noc:ano')) znacky.push(['na noc', '#7da2ff']);
  if (issue.stitky.includes('vetsi-akce')) znacky.push(['větší akce', '#ffb547']);
  if (issue.stitky.includes('pro-vlastnika')) znacky.push(['pro tebe', '#ffd76a']);
  if (issue.stitky.includes('blokovano')) znacky.push(['blokováno', '#ff4d6d']);
  g.font = '600 24px "Segoe UI", system-ui, sans-serif';
  let x = W - 24;
  for (const [text, b] of znacky.reverse()) {
    const w = g.measureText(text).width + 24;
    x -= w;
    g.strokeStyle = b;
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(x, 16, w, 36, 18);
    g.stroke();
    g.fillStyle = b;
    g.fillText(text, x + 12, 43);
    x -= 10;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function postavTabuli() {
  for (const d of [...tabule.children]) uvolni(d);
  const sloupce = (stav.github?.sloupce ?? []).filter((s) => s.issues.length || s.stitek?.startsWith('stav:'));
  const krok = 9 / POLOMER_TABULE;
  sloupce.forEach((sloupec, i) => {
    const uhel = -Math.PI / 2 + (i - (sloupce.length - 1) / 2) * krok;
    const x = Math.cos(uhel) * POLOMER_TABULE;
    const z = Math.sin(uhel) * POLOMER_TABULE;
    const barva = BARVY_SLOUPCU[sloupec.stitek] ?? '#8ea3c7';
    const hlavicka = textovySprite(`${sloupec.nazev} · ${sloupec.issues.length}`, { barva, vyska: 1.4 });
    hlavicka.position.set(x, 19.2, z);
    tabule.add(hlavicka);
    const linka = new THREE.Mesh(
      new THREE.BoxGeometry(8.1, 0.08, 0.08),
      new THREE.MeshBasicMaterial({ color: zari(barva, 2.2) }),
    );
    linka.position.set(x, 18.1, z);
    linka.lookAt(0, 18.1, 0);
    tabule.add(linka);
    const viditelne = sloupec.issues.slice(0, MAX_KARET);
    viditelne.forEach((issue, r) => {
      const karta = new THREE.Mesh(GEO_KARTA, new THREE.MeshBasicMaterial({ map: texturaKarty(issue, barva), transparent: true, side: THREE.DoubleSide }));
      karta.position.set(x, 16.3 - r * 2.8, z);
      karta.lookAt(0, karta.position.y, 0);
      karta.userData.cil = { druh: 'ukol', id: issue.cislo };
      tabule.add(karta);
    });
    if (sloupec.issues.length > MAX_KARET) {
      const vic = textovySprite(`+ ${sloupec.issues.length - MAX_KARET} dalších (2D přehled)`, { barva: '#8ea3c7', vyska: 0.8, vaha: 400 });
      vic.position.set(x, 16.3 - MAX_KARET * 2.8 + 0.9, z);
      tabule.add(vic);
    }
  });
}

function aktualizujMesic() {
  const noc = stav.github?.noc;
  const stop = Boolean(noc?.stop.length);
  const barva = stop ? 0xff4d6d : 0x7da2ff;
  mesicMaterial.emissive.setHex(barva);
  mesicMaterial.emissiveIntensity = stop ? 0.9 : 0.55;
  mesicZare.material.color.copy(zari(barva, stop ? 1.3 : 0.9));
  if (stitekMesice) uvolni(stitekMesice);
  stitekMesice = textovySprite(stop ? 'NOC ZASTAVENA' : `NOČNÍ SMĚNA · ${noc?.fronta.length ?? 0}`, { barva: stop ? '#ff4d6d' : '#a9c1ff', vyska: 0.95 });
  stitekMesice.position.y = 4.3;
  mesic.add(stitekMesice);
  for (const d of [...satelity.children]) uvolni(d);
  (noc?.fronta ?? []).forEach((f, i, vse) => {
    const s = new THREE.Mesh(GEO_CASTICE, new THREE.MeshBasicMaterial({ color: zari(0xffd76a, 3) }));
    s.scale.setScalar(2.2);
    s.userData = { uhel: (i / vse.length) * Math.PI * 2, cil: { druh: 'ukol', id: f.cislo } };
    satelity.add(s);
  });
}

function aktualizujAgenty() {
  const bezi = new Set(stav.bezi.map((b) => b.typ));
  for (const [jmeno, a] of agenti) {
    a.aktivni = bezi.has(jmeno);
    a.zare.visible = a.aktivni;
    a.paprsek.visible = a.aktivni;
    if (!a.aktivni) {
      a.mesh.material.emissiveIntensity = 0.35;
      a.mesh.scale.setScalar(1);
    }
  }
  for (const p of platformy) {
    const aktivni = p.clenove.some((c) => bezi.has(c));
    p.hrany.material.opacity = aktivni ? 1 : 0.55;
    p.sloup.material.opacity = aktivni ? 0.07 : 0.015;
    p.deska.material.emissiveIntensity = aktivni ? 0.18 : 0.05;
  }
}

function sestavKlikaci() {
  klikaci = [jadroKoule, mesicKoule];
  for (const a of agenti.values()) klikaci.push(a.mesh);
  for (const k of krystalyAnim) klikaci.push(k.mesh);
  paprsky.traverse((o) => o.userData.cil && klikaci.push(o));
  tabule.traverse((o) => o.userData.cil && klikaci.push(o));
  satelity.traverse((o) => o.userData.cil && klikaci.push(o));
}

// ---------- HUD a panely ----------

function vsechnyUkoly() {
  const mapa = new Map();
  const g = stav?.github;
  if (!g) return mapa;
  for (const i of [...g.sloupce.flatMap((s) => s.issues), ...g.proVlastnika.issues, ...g.noc.fronta, ...g.noc.stop]) mapa.set(i.cislo, i);
  return mapa;
}

function aktualizujHud() {
  $('repo').textContent = stav.repo ?? 'repozitář neznámý';
  $('c-bezi').textContent = stav.bezi.length;
  const g = stav.github;
  $('c-pr').textContent = g ? g.pr.length : '–';
  $('c-noc').textContent = g ? g.noc.fronta.length : '–';
  $('c-vlastnik').textContent = g ? g.proVlastnika.issues.length + g.proVlastnika.pr.length : '–';
  const b = $('b-noc');
  const stop = Boolean(g?.noc.stop.length);
  b.textContent = stop ? 'Pustit noc' : 'Zastavit noc';
  b.className = stop ? 'aktivni' : 'nebezpecne';
  b.title = 'Přidá nebo zavře issue se štítkem noc:stop. Samotnou rutinu v cloudu zapínáš na claude.ai.';
  const spojeni = $('stav-spojeni');
  spojeni.hidden = !stav.chybaGitHubu;
  if (stav.chybaGitHubu) spojeni.textContent = `GitHub nedostupný: ${stav.chybaGitHubu}`;

  const seznam = $('ceka-seznam');
  seznam.replaceChildren();
  const polozky = g ? [
    ...g.proVlastnika.pr.map((p) => ({ druh: 'pr', cislo: p.cislo, nazev: p.nazev, popis: 'PR' })),
    ...g.proVlastnika.issues.map((i) => ({ druh: 'ukol', cislo: i.cislo, nazev: i.nazev, popis: i.stitky.includes('ranni-zprava') ? 'zpráva' : 'úkol' })),
  ] : [];
  if (!polozky.length) seznam.append(el('li', 'prazdne', g ? 'Nic nečeká.' : 'Bez GitHubu.'));
  for (const p of polozky) {
    const li = el('li');
    const b2 = tlacitko('', () => vyber({ druh: p.druh, id: p.cislo }, true));
    b2.append(el('span', 'cislo', `#${p.cislo}`), el('span', '', p.nazev), el('span', 'stitek', p.popis));
    li.append(b2);
    seznam.append(li);
  }
}

let vybrano = null;

function stitkyEl(stitky) {
  const d = el('div', 'stitky');
  for (const s of stitky) {
    const trida = s === 'schvaleno-vlastnikem' ? 'zlata' : s === 'blokovano' || s === 'noc:stop' ? 'chyba' : s === 'noc:ano' ? 'ok' : '';
    d.append(el('span', `stitek ${trida}`, s));
  }
  return d;
}

function sekce(nadpis, ...obsah) {
  const s = el('div', 'sekce');
  s.append(el('h2', '', nadpis), ...obsah);
  return s;
}

function panelAgent(jmeno) {
  const tym = stav.tymy.find((t) => t.clenove.some((c) => c.jmeno === jmeno));
  const a = tym?.clenove.find((c) => c.jmeno === jmeno);
  const behy = stav.bezi.filter((b) => b.typ === jmeno);
  const o = [el('h3', '', jmeno), el('p', 'podtitul', `${tym?.nazev ?? 'vestavěný agent'}${a?.model ? ` · ${a.model}` : ''}${tym?.vedouci === jmeno ? ' · vedoucí' : ''}`)];
  if (a?.popis) o.push(el('p', '', a.popis));
  const radek = el('div', 'stitky');
  radek.append(
    el('span', `stitek ${behy.length ? 'ok' : ''}`, behy.length ? 'pracuje' : 'čeká'),
    el('span', 'stitek', a?.naposledy ? `naposledy ${pred(a.naposledy)}` : 'zatím neběžel'),
    el('span', 'stitek', `za týden ${a?.zaTyden ?? 0}×`),
  );
  o.push(radek);
  if (behy.length) {
    const ul = el('ul');
    for (const b of behy) {
      const li = el('li', '', `${b.popis ?? 'bez popisu'} · ${pred(b.start)} · spustil ${b.spustil ?? '?'}`);
      if (b.mimoRetez) li.append(el('div', 'varovani', 'Mimo řetěz velení.'));
      ul.append(li);
    }
    o.push(sekce('Právě dělá', ul));
  }
  const historie = stav.historie.filter((b) => b.typ === jmeno && b.konec).slice(0, 5);
  if (historie.length) {
    const ul = el('ul');
    for (const b of historie) ul.append(el('li', '', `${b.popis ?? 'bez popisu'} · ${pred(b.konec)}`));
    o.push(sekce('Naposledy', ul));
  }
  o.push(el('p', 'drobne', 'Agenty spouští manažer přes vedoucí týmů, z Velínu se nespouštějí.'));
  return o;
}

function panelBeh(id) {
  const b = stav.bezi.find((x) => x.id === id);
  if (!b) return [el('h3', '', 'Běh skončil')];
  return [
    el('h3', '', b.typ), el('p', 'podtitul', 'vestavěný agent Claude Code'),
    el('p', '', `${b.popis ?? 'bez popisu'} · ${pred(b.start)} · spustil ${b.spustil ?? '?'}`),
  ];
}

function panelManazer() {
  const o = [el('h3', '', 'Manažer'), el('p', 'podtitul', 'hlavní session Claude Code')];
  const ul = el('ul');
  for (const r of stav.relace) ul.append(el('li', '', `session ${r.session} · ${r.rezim ?? '?'} · od ${pred(r.start)}`));
  if (!stav.relace.length) ul.append(el('li', '', 'Žádná otevřená session.'));
  o.push(sekce('Otevřené session', ul));
  const radek = el('div', 'stitky');
  radek.append(el('span', 'stitek', `běží agentů ${stav.bezi.length}`));
  if (stav.nejasne.length) radek.append(el('span', 'stitek chyba', `nejasné běhy ${stav.nejasne.length}`));
  if (stav.bezi.some((b) => b.mimoRetez)) radek.append(el('span', 'stitek chyba', 'mimo řetěz velení'));
  o.push(radek);
  o.push(el('p', 'drobne', 'Údaje jsou z hooku zaznam-aktivity na tomto počítači. Noční směnu v cloudu tady nevidíš, jen její výsledky na GitHubu.'));
  return o;
}

function panelPR(cislo) {
  const p = stav.github?.pr.find((x) => x.cislo === cislo);
  if (!p) return [el('h3', '', `PR #${cislo}`), el('p', '', 'PR už není otevřený.')];
  const o = [el('h3', '', `#${p.cislo} ${p.nazev}`), el('p', 'podtitul', p.vetev), stitkyEl(p.stitky)];
  const kontroly = el('div', 'stitky');
  for (const [nazev, vysledek] of Object.entries(p.kontroly ?? {})) {
    const druh = stavKontrol({ x: vysledek });
    kontroly.append(el('span', `stitek ${druh}`, `${nazev}: ${vysledek}`));
  }
  if (!kontroly.children.length) kontroly.append(el('span', 'stitek', 'kontroly neznámé'));
  o.push(sekce('Kontroly', kontroly));
  const radek = el('div', 'radek');
  const schvaleny = p.stitky.includes('schvaleno-vlastnikem');
  const b = tlacitko(schvaleny ? 'Schváleno' : 'Schválit PR', (t) => {
    if (confirm(`Schválit PR #${p.cislo}?\n\nPřidá štítek schvaleno-vlastnikem. Sloučí ho manažer po zelené CI.${jeNoc() ? HLIDAC : ''}`)) akce({ typ: 'schvalit', cislo: p.cislo }, t);
  }, 'hlavni');
  b.disabled = schvaleny || !klic;
  radek.append(b);
  const url = urlGitHub('pull', p.cislo);
  if (url) radek.append(odkaz('Otevřít na GitHubu', url));
  o.push(sekce('Akce', radek, el('p', 'drobne', 'Sloučení z Velínu není, to dělá manažer podle PROCES.md.')));
  return o;
}

function panelUkol(cislo) {
  const i = vsechnyUkoly().get(cislo);
  if (!i) return [el('h3', '', `#${cislo}`), el('p', '', 'Úkol už není otevřený.')];
  const g = stav.github;
  const o = [el('h3', '', `#${i.cislo} ${i.nazev}`), el('p', 'podtitul', `založil ${i.autor ?? '?'}`), stitkyEl(i.stitky)];
  const stavy = el('div', 'radek');
  for (const [stitek, nazev] of STAVY) {
    const aktualni = i.stitky.includes(stitek);
    const b = tlacitko(nazev, (t) => akce({ typ: 'stav', cislo: i.cislo, stav: stitek }, t), aktualni ? 'aktivni' : '');
    b.disabled = aktualni || !klic;
    stavy.append(b);
  }
  o.push(sekce('Posunout', stavy));
  const vlastni = g.vlastnik && i.autor && i.autor.toLowerCase() === g.vlastnik.toLowerCase();
  const naNoc = i.stitky.includes('noc:ano');
  const noc = el('div', 'radek');
  const b = tlacitko(naNoc ? 'Odebrat z noci' : 'Poslat na noc', (t) => {
    if (naNoc || confirm(`Poslat #${i.cislo} na noc?\n\nPřidá noc:ano a nastaví stav připraveno. Noční směna ho vezme při příštím běhu, pokud je rutina zapnutá.${jeNoc() ? HLIDAC : ''}`)) {
      akce({ typ: 'noc', cislo: i.cislo, zapnout: !naNoc }, t);
    }
  }, naNoc ? '' : 'hlavni');
  b.disabled = !vlastni || !klic;
  noc.append(b);
  const url = urlGitHub('issues', i.cislo);
  if (url) noc.append(odkaz('Otevřít na GitHubu', url));
  o.push(sekce('Noc', noc, el('p', 'drobne', vlastni
    ? 'Noční směna bere úkoly s noc:ano a stav:pripraveno bez štítků vetsi-akce, blokovano a pro-vlastnika.'
    : 'Na noc jde jen úkol, který jsi založil ty.')));
  return o;
}

function panelNoc() {
  const noc = stav.github?.noc;
  if (!noc) return [el('h3', '', 'Noční směna'), el('p', '', 'Bez GitHubu nevím nic.')];
  const stop = noc.stop.length > 0;
  const o = [el('h3', '', 'Noční směna'), el('p', 'podtitul', stop ? `zastavena štítkem noc:stop (#${noc.stop.map((s) => s.cislo).join(', #')})` : 'štítky ji nezastavují')];
  const radek = el('div', 'radek');
  radek.append(tlacitko(stop ? 'Pustit noc' : 'Zastavit noc', (t) => {
    const text = stop ? `Pustit noc?\n\nZavře issues se štítkem noc:stop.${jeNoc() ? HLIDAC : ''}` : 'Zastavit noc?\n\nZaloží issue se štítkem noc:stop. Noční směna pak nic nezačne.';
    if (confirm(text)) akce({ typ: 'nocStop', zapnout: !stop }, t);
  }, stop ? 'aktivni' : 'nebezpecne'));
  radek.lastChild.disabled = !klic;
  o.push(radek, el('p', 'drobne', 'Samotnou rutinu v cloudu zapínáš a vypínáš na claude.ai. Velín vidí jen štítky na GitHubu.'));
  const fronta = el('ul');
  for (const f of noc.fronta) {
    const li = el('li', '', `#${f.cislo} ${f.nazev} `);
    const b = tlacitko('Odebrat', (t) => akce({ typ: 'noc', cislo: f.cislo, zapnout: false }, t));
    b.disabled = !klic;
    li.append(b);
    fronta.append(li);
  }
  if (!noc.fronta.length) fronta.append(el('li', '', 'Fronta je prázdná.'));
  o.push(sekce('Fronta na příští noc', fronta));
  const zpravy = el('ul');
  for (const z of noc.zpravy) {
    const li = el('li', '', `${z.nazev} · ${pred(z.vytvoreno)} `);
    const url = urlGitHub('issues', z.cislo);
    if (url) li.append(odkaz('otevřít', url));
    zpravy.append(li);
  }
  if (!noc.zpravy.length) zpravy.append(el('li', '', 'Zatím žádná.'));
  o.push(sekce('Ranní zprávy', zpravy));
  return o;
}

function vykresliPanel() {
  if (!vybrano || !stav) return;
  const tvurci = { agent: panelAgent, beh: panelBeh, manazer: panelManazer, pr: panelPR, ukol: panelUkol, noc: panelNoc };
  $('panel-obsah').replaceChildren(...tvurci[vybrano.druh](vybrano.id));
  $('panel').hidden = false;
}

// ---------- výběr a kamera ----------

let letNa = null;
let letKamera = null;
let posledniDotek = 0;
const vyberPrsten = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.05, 8, 64), new THREE.MeshBasicMaterial({ color: zari(0xffffff, 2.5) }));
vyberPrsten.visible = false;
scena.add(vyberPrsten);

function najdiObjekt(cil) {
  return klikaci.find((o) => o.userData.cil?.druh === cil.druh && o.userData.cil?.id === cil.id);
}

function vyber(cil, letet = false) {
  vybrano = cil;
  vykresliPanel();
  if (!ovladani) return;
  ovladani.autoRotate = false;
  const objekt = najdiObjekt(cil);
  if (objekt && letet) {
    letNa = objekt.getWorldPosition(new THREE.Vector3());
    letKamera = null;
  }
}

function pohled(cil, poziceKamery) {
  if (!ovladani) return;
  ovladani.autoRotate = false;
  posledniDotek = performance.now();
  letNa = cil.clone();
  letKamera = poziceKamery?.clone() ?? null;
}

function zavriPanel() {
  vybrano = null;
  $('panel').hidden = true;
  vyberPrsten.visible = false;
  pohled(VYCHOZI_CIL);
}

$('panel-zavrit').addEventListener('click', zavriPanel);
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('novy').open) zavriPanel();
});

const paprsek = new THREE.Raycaster();
const mys = new THREE.Vector2();
let stisk = null;
let najety = null;

function trefa(e) {
  const r = renderer.domElement.getBoundingClientRect();
  mys.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  paprsek.setFromCamera(mys, kamera);
  return paprsek.intersectObjects(klikaci, false)[0]?.object ?? null;
}

function popisek(cil) {
  if (cil.druh === 'agent') {
    const a = agenti.get(cil.id);
    return `${cil.id} · ${a?.tym ?? ''} · ${a?.aktivni ? 'pracuje' : 'čeká'}`;
  }
  if (cil.druh === 'pr') return `PR #${cil.id} ${stav?.github?.pr.find((p) => p.cislo === cil.id)?.nazev ?? ''}`;
  if (cil.druh === 'ukol') return `#${cil.id} ${vsechnyUkoly().get(cil.id)?.nazev ?? ''}`;
  if (cil.druh === 'beh') return stav?.bezi.find((b) => b.id === cil.id)?.typ ?? 'agent';
  return cil.druh === 'noc' ? 'Noční směna' : 'Manažer';
}

if (renderer) {
  const platno = renderer.domElement;
  platno.addEventListener('pointermove', (e) => {
    const o = trefa(e);
    najety = o;
    platno.style.cursor = o ? 'pointer' : '';
    const t = $('tooltip');
    t.hidden = !o;
    if (o) {
      t.textContent = popisek(o.userData.cil);
      t.style.left = `${e.clientX + 14}px`;
      t.style.top = `${e.clientY + 12}px`;
    }
  });
  platno.addEventListener('pointerleave', () => {
    najety = null;
    $('tooltip').hidden = true;
  });
  platno.addEventListener('pointerdown', (e) => {
    stisk = { x: e.clientX, y: e.clientY };
  });
  platno.addEventListener('pointerup', (e) => {
    if (!stisk || Math.hypot(e.clientX - stisk.x, e.clientY - stisk.y) > 5) return;
    const o = trefa(e);
    if (o) vyber(o.userData.cil, true);
  });
  ovladani.addEventListener('start', () => {
    posledniDotek = performance.now();
    ovladani.autoRotate = false;
    letNa = letKamera = null;
  });
}

// ---------- tlačítka v hlavičce ----------

let naTabuli = false;
$('b-tabule').addEventListener('click', (e) => {
  naTabuli = !naTabuli;
  e.currentTarget.textContent = naTabuli ? 'Celek' : 'Úkoly';
  if (naTabuli) pohled(POHLED_TABULE.cil, POHLED_TABULE.kamera);
  else pohled(VYCHOZI_CIL, new THREE.Vector3(0, 27, 47));
});
$('b-novy').addEventListener('click', () => {
  $('novy-form').reset();
  $('novy').showModal();
  $('novy-nazev').focus();
});
$('novy-zrusit').addEventListener('click', () => $('novy').close());
$('novy-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const odeslat = e.submitter ?? $('novy-form').querySelector('[type=submit]');
  const ok = await akce({ typ: 'novy', nazev: $('novy-nazev').value, popis: $('novy-popis').value }, odeslat);
  if (ok) $('novy').close();
});
$('b-noc').addEventListener('click', (e) => {
  const stop = Boolean(stav?.github?.noc.stop.length);
  const text = stop ? `Pustit noc?\n\nZavře issues se štítkem noc:stop.${jeNoc() ? HLIDAC : ''}` : 'Zastavit noc?\n\nZaloží issue se štítkem noc:stop. Noční směna pak nic nezačne.';
  if (confirm(text)) akce({ typ: 'nocStop', zapnout: !stop }, e.currentTarget);
});

// ---------- data ----------

async function obnov() {
  try {
    const odpoved = await fetch('/api/stav', { cache: 'no-store' });
    if (!odpoved.ok) throw new Error(`Chyba ${odpoved.status}`);
    stav = await odpoved.json();
  } catch {
    const s = $('stav-spojeni');
    s.hidden = false;
    s.textContent = 'Spojení s Velínem ztraceno. Běží ještě `npm run velin`?';
    return;
  }
  const podpis = JSON.stringify(stav.tymy.map((t) => [t.nazev, t.vedouci, t.clenove.map((c) => c.jmeno)]));
  if (podpis !== podpisTymu) {
    podpisTymu = podpis;
    postavTymy(stav.tymy);
  }
  aktualizujAgenty();
  postavPaprsky();
  postavKrystaly();
  postavTabuli();
  aktualizujMesic();
  sestavKlikaci();
  aktualizujHud();
  vykresliPanel();
}

// ---------- animace ----------

const hodiny = new THREE.Timer();
const pomoc = new THREE.Vector3();
function snimek() {
  hodiny.update();
  const t = hodiny.getElapsed() * (pomalu ? 0.2 : 1);
  jadroSit.rotation.y = t * 0.25;
  jadroSit.rotation.x = t * 0.1;
  jadroPrstence.forEach((p, i) => {
    p.rotation.z = t * (0.3 + i * 0.15) * (i % 2 ? -1 : 1);
  });
  jadroKoule.scale.setScalar(1 + Math.sin(t * 2) * 0.04);
  hvezdy.rotation.y = t * 0.004;
  mesicKoule.rotation.y = t * 0.05;
  mesic.position.y = 17 + Math.sin(t * 0.4) * 0.5;

  for (const a of agenti.values()) {
    if (!a.aktivni) continue;
    const puls = (Math.sin(t * 4 + a.faze) + 1) / 2;
    a.mesh.material.emissiveIntensity = 1.6 + puls * 2.2;
    a.mesh.scale.setScalar(1 + puls * 0.15);
    a.zare.material.opacity = 0.55 + puls * 0.45;
  }
  for (const c of castice) {
    const u = (t * 0.28 + c.posun) % 1;
    c.krivka.getPoint(u, c.mesh.position);
  }
  for (const k of krystalyAnim) {
    const u = k.uhel + t * 0.12;
    k.skupina.position.set(Math.cos(u) * 8.2, 4.2 + Math.sin(t * 0.8 + k.uhel * 3) * 0.5, Math.sin(u) * 8.2);
    k.mesh.rotation.y = t * 0.9;
    k.mesh.rotation.x = t * 0.4;
    if (k.cekaNaMe) k.mesh.scale.setScalar(1 + ((Math.sin(t * 3) + 1) / 2) * 0.25);
  }
  satelity.children.forEach((s) => {
    const u = s.userData.uhel + t * 0.6;
    s.position.set(Math.cos(u) * 3.6, Math.sin(u * 0.7) * 0.8, Math.sin(u) * 3.6);
  });
  for (const o of tabule.children) {
    if (!o.userData.cil) continue;
    const cilova = o === najety ? 1.07 : 1;
    o.scale.setScalar(o.scale.x + (cilova - o.scale.x) * 0.2);
  }

  if (vybrano) {
    const o = najdiObjekt(vybrano);
    if (o) {
      o.getWorldPosition(pomoc);
      vyberPrsten.visible = true;
      vyberPrsten.position.copy(pomoc);
      vyberPrsten.quaternion.copy(kamera.quaternion);
      const r = o.geometry.boundingSphere?.radius ?? (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere.radius);
      vyberPrsten.scale.setScalar(Math.max(r, 0.6) * 1.3 * (1 + Math.sin(t * 5) * 0.05));
    } else vyberPrsten.visible = false;
  }
  if (letNa) {
    pomoc.copy(letNa).sub(ovladani.target).multiplyScalar(0.07);
    ovladani.target.add(pomoc);
    if (letKamera) kamera.position.lerp(letKamera, 0.07);
    else kamera.position.add(pomoc);
    if (pomoc.lengthSq() < 1e-6 && (!letKamera || kamera.position.distanceToSquared(letKamera) < 1e-4)) letNa = letKamera = null;
  }
  if (!pomalu && !vybrano && !naTabuli && !ovladani.autoRotate && performance.now() - posledniDotek > 25_000) ovladani.autoRotate = true;
  ovladani.update();
  skladac.render();
}

ukazOvladani();
if (renderer) {
  renderer.setAnimationLoop(snimek);
  obnov();
  setInterval(obnov, OBNOVA_MS);
}
