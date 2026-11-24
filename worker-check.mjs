// فحص الـ Worker على SQLite حقيقي (node:sqlite) + شوبيفاي وهمي — بلا أي شبكة.
// التشغيل: node worker-check.mjs   (Node 22+)
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`
  CREATE TABLE logs (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, tool TEXT, type TEXT, employee TEXT, order_id TEXT, order_name TEXT, sku TEXT, product_title TEXT, delta INTEGER, value_before INTEGER, value_after INTEGER, notes TEXT, extra TEXT);
  CREATE TABLE employees (username TEXT PRIMARY KEY, display_name TEXT NOT NULL, pin TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT, last_login TEXT);
  CREATE TABLE log_value_alerts (source_tool TEXT, tool TEXT, type TEXT, first_seen TEXT, last_seen TEXT, hits INTEGER, worker_version TEXT, sample_order_name TEXT, sample_employee TEXT, sample_notes TEXT, status TEXT DEFAULT 'open', PRIMARY KEY (source_tool, tool, type));
  INSERT INTO employees (username, display_name, pin) VALUES ('Ali','Ali','1234'), ('Sara','Sara','9999'), ('NoPin','NoPin',NULL);
`);
// D1 shim فوق node:sqlite
function stmt(sql) {
  let args = [];
  const api = {
    bind(...a) { args = a; return api; },
    async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    _exec() { return api.run(); },
  };
  return api;
}
const DB = { prepare: stmt, async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; } };

// شوبيفاي وهمي
let choices = ['Bosta', 'Showroom', 'Ahmed Ali', 'Mona'];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('/oauth/access_token')) return new Response(JSON.stringify({ access_token: 't' }), { status: 200 });
  const body = JSON.parse(init.body);
  if (body.query.includes('metafieldDefinitionUpdate')) {
    const v = body.variables.definition.validations.find(x => x.name === 'choices');
    choices = JSON.parse(v.value);
    return new Response(JSON.stringify({ data: { metafieldDefinitionUpdate: { updatedDefinition: { id: 'd', validationStatus: 'COMPLETED', validations: [] }, userErrors: [] } } }), { status: 200 });
  }
  return new Response(JSON.stringify({ data: { metafieldDefinitions: { nodes: [{ id: 'd', name: 'Courier', type: { name: 'single_line_text_field' }, validationStatus: 'COMPLETED', validations: [{ name: 'choices', value: JSON.stringify(choices) }] }] } } }), { status: 200 });
};

const worker = (await import('./index.js')).default;
const env = { DB, WORKER_SECRET: 's3cret', SHOP_DOMAIN: 'x.myshopify.com', CLIENT_ID: 'a', CLIENT_SECRET: 'b' };
const call = async (action, body, method) => {
  const r = await worker.fetch(new Request(`https://w/?action=${action}`, {
    method: method || (body ? 'POST' : 'GET'), headers: { Authorization: 'Bearer s3cret', 'Content-Type': 'application/json', Origin: 'https://ecommoda-dev.github.io' },
    body: body ? JSON.stringify(body) : undefined }), env);
  return { http: r.status, ...(await r.json()) };
};
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const logsOf = (type) => sqlite.prepare('SELECT * FROM logs WHERE type = ?').all(type);

// ── get_couriers: القايمة من شوبيفاي، والبروفايل فاضي للجميع ──
let r = await call('get_couriers');
eq(r.couriers, ['Bosta', 'Showroom', 'Ahmed Ali', 'Mona']);
ok(r.profiles['Ahmed Ali'].missing.length === 3, 'مندوب جديد = ناقص ٣ حقول');
eq(r.profiles['Bosta'].missing, [], 'Bosta بلا بيانات شخصية مطلوبة');
ok(r.profilesError === null);

// ── تليفون ──
r = await call('update_courier_profile', { employee: 'Ali', name: 'Ahmed Ali', phonePrimary: '+20 100-123-4567', phoneSecondary: '٠١١٢٣٤٥٦٧٨٩' });
ok(r.status === 'success', JSON.stringify(r));
eq([r.profile.phonePrimary, r.profile.phoneSecondary], ['01001234567', '01123456789']);
r = await call('update_courier_profile', { employee: 'Ali', name: 'Ahmed Ali', phonePrimary: '12345' });
ok(r.status === 'rejected' && /موبايل مصري/.test(r.error));
r = await call('update_courier_profile', { employee: 'Ali', name: 'Ahmed Ali', phonePrimary: '01001234567' });
ok(r.status === 'already', 'نفس القيمة = already');
r = await call('update_courier_profile', { employee: 'Ali', name: 'Mona', phonePrimary: '01001234567' });
ok(r.status === 'success' && r.notices.length === 1, 'تليفون مكرر = تنبيه مش منع');
r = await call('update_courier_profile', { employee: 'Ali', name: 'Bosta', phonePrimary: '01001234567' });
ok(r.status === 'rejected' && /نظامي/.test(r.error), 'الاسم النظامي مرفوض');
r = await call('update_courier_profile', { employee: 'Ali', name: 'غير موجود', phonePrimary: '01001234567' });
ok(r.status === 'rejected' && /مش في قايمة/.test(r.error));
// optimistic concurrency
let ver = (await call('get_couriers')).profiles['Ahmed Ali'].version;
r = await call('update_courier_profile', { employee: 'Ali', name: 'Ahmed Ali', phoneSecondary: '01234567890', expectedVersion: ver - 1 });
ok(r.status === 'rejected' && /اتعدّلت من حد تاني/.test(r.error), 'نسخة قديمة مرفوضة');
// extra
r = await call('update_courier_profile', { employee: 'Ali', name: 'Mona', extra: { منطقة: 'مدينة نصر', ok: true } });
eq(r.profile.extra, { منطقة: 'مدينة نصر', ok: true });
r = await call('update_courier_profile', { employee: 'Ali', name: 'Mona', extra: { bad: { x: 1 } } });
ok(r.status === 'rejected');

// ── صورة ──
const jpg = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(2000, 7)]).toString('base64');
r = await call('set_courier_photo', { employee: 'Ali', name: 'Ahmed Ali', dataUrl: jpg });
ok(r.status === 'success' && r.profile.hasPhoto, JSON.stringify(r));
const fake = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF]), Buffer.alloc(50)]).toString('base64');
r = await call('set_courier_photo', { employee: 'Ali', name: 'Ahmed Ali', dataUrl: fake });
ok(r.status === 'rejected' && /مش مطابق/.test(r.error), 'magic bytes مختلفة عن النوع');
r = await call('set_courier_photo', { employee: 'Ali', name: 'Ahmed Ali', dataUrl: 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF]), Buffer.alloc(200 * 1024)]).toString('base64') });
ok(r.status === 'rejected' && /كبيرة/.test(r.error));
r = await call('get_courier_photo&name=Ahmed%20Ali');
ok(r.ok && r.dataUrl === jpg, 'الصورة بترجع زي ما اتخزنت');
r = await call('set_courier_photo', { employee: 'Ali', name: 'Ahmed Ali', dataUrl: null });
ok(r.status === 'success' && r.removed && !r.profile.hasPhoto);
r = await call('set_courier_photo', { employee: 'Ali', name: 'Ahmed Ali', dataUrl: null });
ok(r.status === 'already');

// ── الرقم القومي: PIN ──
const NID = '29001010100011'; // 1990-01-01 · القاهرة · ٠٠١١ (فردي = ذكر)
r = await call('set_national_id', { employee: 'Ali', name: 'Ahmed Ali', nationalId: NID });
ok(r.http === 400 || r.http === 403, 'بلا PIN = مرفوض');
r = await call('set_national_id', { employee: 'Ali', pin: '0000', name: 'Ahmed Ali', nationalId: NID });
ok(r.http === 403 && r.code === 'bad_pin' && r.attemptsLeft === 4);
r = await call('set_national_id', { employee: 'NoPin', pin: '1', name: 'Ahmed Ali', nationalId: NID });
ok(r.code === 'no_pin');
r = await call('set_national_id', { employee: 'Ali', pin: '1234', name: 'Ahmed Ali', nationalId: '123' });
ok(r.status === 'rejected' && /١٤ رقم/.test(r.error));
r = await call('set_national_id', { employee: 'Ali', pin: '1234', name: 'Ahmed Ali', nationalId: '29913010100011' });
ok(r.status === 'rejected' && /تاريخ الميلاد/.test(r.error), 'شهر ١٣');
r = await call('set_national_id', { employee: 'Ali', pin: '1234', name: 'Ahmed Ali', nationalId: NID });
ok(r.status === 'success' && r.nationalIdMasked === '••••••••••0011', JSON.stringify(r));
r = await call('set_national_id', { employee: 'Ali', pin: '1234', name: 'Mona', nationalId: NID });
ok(r.status === 'rejected' && /متسجّل لمندوب تاني/.test(r.error), 'تكرار الرقم القومي');
r = await call('set_national_id', { employee: 'Ali', pin: '1234', name: 'Ahmed Ali', nationalId: NID });
ok(r.status === 'already');

// القايمة العادية: مقنّع بس
const list = await call('get_couriers');
eq([list.profiles['Ahmed Ali'].hasNationalId, list.profiles['Ahmed Ali'].nationalIdMasked], [true, '••••••••••0011']);
ok(!JSON.stringify(list).includes(NID), 'الرقم الكامل مش في get_couriers');
const pub = await call('get_courier_profiles');
ok(!JSON.stringify(pub).includes(NID) && !('nationalIdMasked' in pub.profiles[0]) && !('hasNationalId' in pub.profiles[0]), 'المستوى العام بلا أي أثر للرقم القومي');

// ── فتح الرقم القومي ──
r = await call('reveal_national_id', { employee: 'Ali', pin: '1234', name: 'Ahmed Ali' });
ok(r.ok && r.nationalId === NID && r.info.gender === 'ذكر' && r.info.governorate === 'القاهرة' && r.info.birthDate === '1990-01-01', JSON.stringify(r));
eq(logsOf('view_sensitive').length, 1, 'فتح واحد = صف مراجعة واحد');
r = await call('reveal_national_id', { employee: 'Ali', pin: '1234', name: 'Mona' });
ok(r.status === 'already', 'مفيش رقم لمنى');

// ── لا قيمة حساسة في أي سجل ──
const allLogs = JSON.stringify(sqlite.prepare('SELECT * FROM logs').all());
ok(!allLogs.includes(NID), 'الرقم القومي مش في logs');
ok(!/"pin"/i.test(allLogs), 'مفيش حقل pin في logs');

// ── قفل بعد ٥ محاولات غلط ──
for (let i = 0; i < 4; i++) await call('reveal_national_id', { employee: 'Sara', pin: 'x', name: 'Ahmed Ali' });
r = await call('reveal_national_id', { employee: 'Sara', pin: 'x', name: 'Ahmed Ali' });
ok(r.http === 429 && r.code === 'locked', 'القفل عند الخامسة');
r = await call('reveal_national_id', { employee: 'Sara', pin: '9999', name: 'Ahmed Ali' });
ok(r.http === 429 && r.code === 'locked', 'PIN الصح مرفوض أثناء القفل');
sqlite.prepare("UPDATE courier_pin_attempts SET locked_until = ? WHERE username = 'Sara'").run(new Date(Date.now() - 1000).toISOString());
r = await call('reveal_national_id', { employee: 'Sara', pin: '9999', name: 'Ahmed Ali' });
ok(r.ok, 'بعد انتهاء القفل بيشتغل');
ok(logsOf('rejected').length >= 6, 'كل محاولة مرفوضة اتسجّلت');

// ── fail-closed: لو السجل فشل مفيش عرض ──
sqlite.exec('ALTER TABLE logs RENAME TO logs_off');
r = await call('reveal_national_id', { employee: 'Ali', pin: '1234', name: 'Ahmed Ali' });
ok(r.http === 500 && !('nationalId' in r) && !JSON.stringify(r).includes(NID), 'مفيش رقم بدون سجل');
sqlite.exec('ALTER TABLE logs_off RENAME TO logs');

// ── دورة الإضافة والحذف ──
r = await call('add_courier', { employee: 'Ali', name: 'Karim' });
ok(r.status === 'success' && r.profile === 'created', JSON.stringify(r));
r = await call('remove_courier', { employee: 'Ali', name: 'Ahmed Ali' });
ok(r.status === 'success' && r.profile === 'removed');
let l2 = await call('get_couriers');
ok(!l2.couriers.includes('Ahmed Ali') && l2.removedProfiles.some(p => p.name === 'Ahmed Ali'), 'البروفايل بيفضل (soft) بعد الحذف');
eq(sqlite.prepare("SELECT status FROM courier_profiles WHERE name='Ahmed Ali'").get().status, 'removed');
ok(sqlite.prepare('SELECT COUNT(*) n FROM courier_sensitive').get().n === 1, 'الرقم القومي ما اتمسحش مع الحذف');
r = await call('add_courier', { employee: 'Ali', name: 'Ahmed Ali' });
ok(r.status === 'success' && r.profile === 'reactivated' && /نفس الشخص/.test(r.profileNotice), 'إعادة الإضافة = رجوع البروفايل مع تنبيه');
eq((await call('get_couriers')).profiles['Ahmed Ali'].nationalIdMasked, '••••••••••0011');

// ── فشل D1 بعد نجاح شوبيفاي = warning مش rollback ──
sqlite.exec('ALTER TABLE courier_profiles RENAME TO cp_off');
r = await call('add_courier', { employee: 'Ali', name: 'Hany' });
ok(r.status === 'warning' && choices.includes('Hany') && r.warnings.some(w => /D1/.test(w)), 'القايمة اتكتبت والبروفايل warning');
sqlite.exec('ALTER TABLE cp_off RENAME TO courier_profiles');
l2 = await call('get_couriers');
ok(l2.couriers.includes('Hany') && l2.profiles['Hany'].id === null, 'مندوب بلا بروفايل = فاضي بدل ما يقع');

// ── سجل الإدارة القديم لسه شغّال ──
r = await call('reorder_couriers', { employee: 'Ali', couriers: [...choices].reverse() });
ok(r.status === 'success');
r = await call('get_logs');
ok(r.ok && r.entries.length > 5);
const unreg = sqlite.prepare('SELECT COUNT(*) n FROM log_value_alerts').get().n;
eq(unreg, 0, 'كل قيم اللوج مسجّلة — الحارس الديناميكي ما سجّلش أي تنبيه');

console.log(`✓ ${n} بند عدّى`);
