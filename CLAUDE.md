# Courier-Names — Worker أسماء المناديب (`courier-names-worker`)

**الإصدار:** `2.0.0` · **الأداة:** أسماء المناديب — إضافة / حذف / ترتيب قايمة `custom.courier` **+ بروفايل المندوب في D1** (تليفونين · صورة · رقم قومي بـPIN · `extra`)

> 🔴 **الريبو ده Worker وبس.** الواجهة صفحة `Courier-Names.html` جوّه
> `Delivery-COD-Operations-Center` (قسم «أدوات أخرى» في الرئيسية). نفس نمط
> `Partial-Delivery` / `Bosta-Orders-Upload`. **مفيش HTML هنا ومفيش نسخة تانية.**
> ⛔ أي تعديل على الشاشة بيتعمل في ريبو الهب. أي تعديل على المنطق هنا.

## بتعمل إيه (v2.0.0)

**جزء ١ — قايمة شوبيفاي** (زي ما كانت): تعريف ميتافيلد الأوردرات `custom.courier` (Choice list ·
`single_line_text_field`)، التعديل بـ`metafieldDefinitionUpdate`. **صفر كتابة على أي أوردر.**
**جزء ٢ — بروفايل المندوب في D1** (جديد): خصائص مربوطة بالاسم. 🔴 **شوبيفاي هي اللي بتقرر مين في
القايمة وترتيبه — D1 بتضيف بيانات بس، ومابتخزّنش ترتيب ولا بتضيف/تشيل اسم.**

القيم المسموحة = `validations[choices]`.

| action | method | بتعمل |
|---|---|---|
| `get_config` · `diag` | GET | النسخة · فحص ذاتي (سر + بصمة + D1 + OAuth + `write_orders` + قراءة التعريف + `throttleStatus`/`actualQueryCost`) |
| `get_couriers` | GET | القايمة الحالية بالترتيب + `validationStatus` + الأسماء النظامية |
| `courier_usage?name=` | GET | كام أوردر عليه المندوب (إجمالي · نشط S1: `Ready`/`Shipped`/`In-Return`) + `reliable` |
| `add_courier` | POST | `{employee, name}` — بيتضاف **في آخر القايمة** |
| `remove_courier` | POST | `{employee, name}` |
| `reorder_couriers` | POST | `{employee, couriers[]}` — ترتيب بس، **نفس الأسماء** |
| `get_logs` | GET | آخر تعديلات الأداة (حد أقصى ١٠٠) |
| `get_couriers` (v2) | GET | + `profiles{اسم→بروفايل}` (تليفونين · `hasPhoto` · `nationalIdMasked` · `missing[]` · `version`) + `removedProfiles` + `profilesError` |
| `get_courier_profiles` | GET | **للأدوات التانية** — D1 بس (بلا شوبيفاي)، `?status=all` يشمل المحذوفين. **بلا أي حقل رقم قومي** |
| `get_courier_photo?name=` | GET | الصورة كـ`dataUrl` (الـ`<img src>` مابيبعتش Authorization) |
| `update_courier_profile` | POST | `{employee, name, phonePrimary?, phoneSecondary?, extra?, expectedVersion?}` |
| `set_courier_photo` | POST | `{employee, name, dataUrl\|null}` — JPEG/PNG/WebP ≤ ١٥٠KB (الواجهة بتصغّر ٢٥٦px) |
| `reveal_national_id` | POST | `{employee, pin, name}` — **PIN** + سجل قبل العرض (fail-closed) |
| `set_national_id` | POST | `{employee, pin, name, nationalId\|null}` — **PIN** |

## 🔴 القواعد اللي الكود مبني عليها

- **كل فعل بيقرا القايمة الحالية من شوبيفاي ويطبّق عليها** — مش بيستبدلها
  بنسخة الواجهة. استثناء `reorder_couriers`: لو الأسماء اتغيّرت من حد تاني
  بيترفض «القايمة اتغيّرت».
- **بعد كل كتابة إعادة قراءة** — `userErrors: []` مش دليل. اختلاف = `warning`.
- **الأسماء النظامية (`Bosta` · `Showroom`) مابتتحذفش** — `dcoCourierGroup`
  في الهب بيجمّع بالاسم، وأدوات بوسطة بتعتمد على `Bosta`. (`PROTECTED_NAMES`.)
- **ممنوع تفضية القايمة** — لازم مندوب واحد على الأقل.
- **مفيش rename** (قرار أحمد: إضافة/حذف/ترتيب بس) — اسم جديد = قيمة جديدة،
  والأوردرات القديمة بتفضل بالاسم القديم.
- **حذف اسم مابيمسحش قيمته من الأوردرات** — شوبيفاي بتعلّمها «غير صالحة»
  بس. عشان كده الواجهة بتعرض `courier_usage` وبتطلب تأكيد.
- `courier_usage`: فلتر `custom.courier` اتقاس شغّال (control = ٠). الرقم
  **مش موثوق** لو الـ control ≠ ٠ (`reliable:false`) — الواجهة بتقولها بالنص.
  والإجمالي ممكن يتقص عند ١٠٬٠٠٠ (`capped`).

## 🔴 بروفايل المندوب — القرارات (أحمد 24-11-2026)

| القرار | التفاصيل |
|---|---|
| الربط | بالاسم (`name_norm` فريد). الاسم نص حر = قيمة شوبيفاي بالحرف. **مفيش rename** |
| الترتيب مع شوبيفاي | **شوبيفاي الأول ثم D1.** فشل D1 بعد نجاح شوبيفاي = `warning` مش rollback، والبروفايل بيتكوّن عند أول تعديل على بياناته |
| الحذف | **soft**: `status='removed'` — البيانات (الرقم القومي والصورة) **بتفضل**. ⛔ مفيش «مسح نهائي» (قرار أحمد) |
| إعادة إضافة نفس الاسم | البروفايل القديم بيرجع **مع تنبيه** (ممكن شخص تاني بنفس الاسم) |
| `Bosta`/`Showroom` | `kind` = `company`/`showroom` — بلا بيانات شخصية، والتعديل عليهم مرفوض |
| الحقول | أعمدة ثابتة + `extra` JSON (≤ ٢٠ مفتاح · قيم نص/رقم/boolean) |
| التليفون | موبايل مصري `01[0125]xxxxxxxx` (بيقبل `+20`/`0020` وأرقام عربي). تكرار الرقم عند مندوب تاني = **تنبيه مش منع** |
| الرقم القومي | ١٤ رقم، مراجعة بنيته (قرن · تاريخ ميلاد · كود محافظة). **نص عادي مخفي في العرض** (قرار أحمد — مفيش تشفير). `UNIQUE` |
| الصورة | **مش حساسة** (قرار أحمد). مصغّرة base64 في D1، التحقق بالـmagic bytes مش بالـmime المكتوب |
| التزامن | `version` + `expectedVersion` (optimistic) — تعديل من حد تاني = `rejected` |

### 🔒 الرقم القومي — الحماية (الصادق عن حدودها)

- **PIN الموظف في كل فتح وكل تعديل** (في الـbody · جدول `employees` المشترك) — مش السر المشترك بس. ده اللي بيخلّي
  «مين فتح الرقم» إثبات مش شرف. **مفيش قايمة موظفين محددة** (قرار أحمد): أي موظف بـPIN صالح.
- **حد المحاولات:** ٥ PIN غلط ← قفل ١٠ دقايق للموظف ده (`courier_pin_attempts` — في D1 مش في ذاكرة الـisolate).
- **كل فتح بيتسجّل `view_sensitive` قبل العرض** — لو السجل فشل الرقم **مابيتبعتش** (fail-closed). كل PIN مرفوض بيتسجّل `rejected`.
- ⛔ **ممنوع أي قيمة حساسة في `logs`** (لا الرقم ولا الـPIN) — اسم الحقل بس.
- ⚠️ **حدودها:** الرقم نص عادي في D1 — أي حد بصلاحية D1 (داشبورد/Console/MCP) يشوفه. حاجز الـPIN شغّال على الـAPI بس.
  وده سبب الجدول المنفصل: القارئ الخارجي مايقدرش يجيبه بالغلط.
- ⚠️ الـPIN في `employees` نص عادي (استثناء موثّق في `d1-schema.md`) — حماية الرقم القومي بترث ده.

## 📜 عقد القراءة للأدوات التانية (D1 مشتركة) — أي هب حالي أو مستقبلي

| الجدول | مسموح؟ | الأعمدة |
|---|---|---|
| `courier_profiles` | ✅ **قراءة بس** | `id` · `name` · `name_norm` · `kind` (`person`/`company`/`showroom`) · `status` (`active`/`removed`) · `phone_primary` · `phone_secondary` · `extra` (JSON) · `version` · `updated_at` |
| `courier_photos` | ✅ **قراءة بس** | `courier_id` · `mime` · `data` (base64 بلا prefix) · `bytes` · `updated_at` |
| `courier_sensitive` | ⛔ **ممنوع** — `courier-names-worker` وحده | الرقم القومي |
| `courier_pin_attempts` | ⛔ **ممنوع** | عدّاد PIN |

- 🔴 **الربط بالاسم:** `courier_profiles.name_norm` == `lower(trim(collapse-spaces(قيمة custom.courier)))`. ⛔ خد الترتيب ومين في
  القايمة من شوبيفاي مش من D1 (`status='removed'` مش معناها «مش في القايمة» بالضرورة وقت لحظة التعديل).
- 🔴 **لو الأداة في هب بنفس سر `delivery_cod_ops`:** الأسهل `GET get_courier_profiles` (بلا رقم قومي). **هب المخزن** (`warehouse_ops` — سر مختلف)
  يقرا D1 مباشرة من الجدولين المسموحين.
- ⚠️ عقد بلا إصدار: تغيير اسم/معنى عمود = ليستة فاضية عند القارئ بلا خطأ. **غيّر في الطرفين معًا** وحدّث الجدول ده.
- ⚠️ الجداول بتتكوّن تلقائي (`CREATE TABLE IF NOT EXISTS` في `ensureSchema`) أول طلب — الشكل المرجعي في `schema.sql`.
- ⚠️ الصورة `data` base64 — اعرضها بـ`data:${mime};base64,${data}`. الصفوف ~١٥–٣٠KB؛ ⛔ ماتجيبش كل الصور في استعلام قايمة (استعلم للمطلوب بس).

## D1

```
tool : courier_names
type : add_courier · remove_courier · reorder_couriers   ← اتبعتت لشوبيفاي (result: success/warning/error)
       profile_update · photo_update · sensitive_update  ← كتابة في D1 (result: success) — extra.fields = أسماء الحقول بس
       view_sensitive                                    ← فتح الرقم القومي بعد PIN (سجل مراجعة)
       rejected                                          ← اتوقف قبل أي كتابة (result: rejected/already) — شامل PIN مرفوض/مقفول
```

`value_before`/`value_after` = القايمة كاملة JSON (أفعال القايمة بس — أفعال البروفايل: `extra.fields` أسماء الحقول بلا قيم). السجل في `log-values.json`
(`node check-log-values.mjs` لازم exit 0 قبل أي تسليم).

⛔ **قيمة `tool = 'courier_names'` + الـtypes الأربعة الجديدة (`profile_update` · `photo_update` · `sensitive_update` · `view_sensitive`) لسه مش في فهرس `ecommoda-constants` §7.1**
(جدول tool → ريبو) — بند مفتوح لازم يتسجّل هناك. الحارس الديناميكي مش
بيرفض الكتابة، بس بيعلّم `_unregistered` لو القيمة برّه `LOG_REGISTRY`.

## CORS · الأسرار · النشر

- CORS Option B: `https://ecommoda-dev.github.io` فقط (أداة كتابة).
- **`WORKER_SECRET` = قيمة مجموعة `delivery_cod_ops`** (لازم تتسجّل العضوية
  في `references/secret-groups.md` — وإلا التدوير بيتكسر بصمت) + `CLIENT_ID`/
  `CLIENT_SECRET`. بعد أي سر: **Promote**.
- `SHOP_DOMAIN` في `[vars]` بتاع `wrangler.toml`.
- الـ Custom App محتاج `write_orders` — `?action=diag` بيقول لو ناقصة.
- Workers Builds على الريبو ده → `courier-names-worker` (الاسم في `wrangler.toml`
  لازم يطابق الداشبورد).
- ⛔ مفيش endpoints دخول (`verify_employee` …) — الدخول في Worker الهب،
  والواجهة بتبعت `employee` من جلسة الهب.

## بصمة المهارات

| المهارة | الإصدار |
|---|---|
| ecommoda-worker-builder | v4.2.0 |
| ecommoda-constants | v4.1.0 |

## الفحص

```bash
node worker-check.mjs        # ٥٣ بند — SQLite حقيقي (node:sqlite) + شوبيفاي وهمي، بلا شبكة (Node 22+)
node check-log-values.mjs    # لازم exit 0 قبل أي تسليم
```
⚠️ **ما اتجرّبش على D1 ولا شوبيفاي حقيقيين.** `D1` الحقيقية ممكن تفرق في تفاصيل (`meta.changes` · `batch`) — أول نداء حقيقي بعد النشر هو الاختبار الفعلي، ومعاه `?action=diag`.

آخر تحديث: 24-11-2026 — v2.0.0 (بروفايل المندوب في D1 · الرقم القومي بـPIN). السابق: 05-10-2026 — v1.0.0 (الإطلاق الأول).
