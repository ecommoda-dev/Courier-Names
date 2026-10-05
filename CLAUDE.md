# Courier-Names — Worker أسماء المناديب (`courier-names-worker`)

**الإصدار:** `1.0.0` · **الأداة:** أسماء المناديب — إضافة / حذف / ترتيب قايمة `custom.courier`

> 🔴 **الريبو ده Worker وبس.** الواجهة صفحة `Courier-Names.html` جوّه
> `Delivery-COD-Operations-Center` (قسم «أدوات أخرى» في الرئيسية). نفس نمط
> `Partial-Delivery` / `Bosta-Orders-Upload`. **مفيش HTML هنا ومفيش نسخة تانية.**
> ⛔ أي تعديل على الشاشة بيتعمل في ريبو الهب. أي تعديل على المنطق هنا.

## بتعمل إيه

بتقرا وبتعدّل **تعريف** ميتافيلد الأوردرات `custom.courier` (Choice list ·
`single_line_text_field`) — القيم المسموحة = `validations[choices]`. التعديل
بـ`metafieldDefinitionUpdate`. **صفر كتابة على أي أوردر.**

| action | method | بتعمل |
|---|---|---|
| `get_config` · `diag` | GET | النسخة · فحص ذاتي (سر + بصمة + D1 + OAuth + `write_orders` + قراءة التعريف + `throttleStatus`/`actualQueryCost`) |
| `get_couriers` | GET | القايمة الحالية بالترتيب + `validationStatus` + الأسماء النظامية |
| `courier_usage?name=` | GET | كام أوردر عليه المندوب (إجمالي · نشط S1: `Ready`/`Shipped`/`In-Return`) + `reliable` |
| `add_courier` | POST | `{employee, name}` — بيتضاف **في آخر القايمة** |
| `remove_courier` | POST | `{employee, name}` |
| `reorder_couriers` | POST | `{employee, couriers[]}` — ترتيب بس، **نفس الأسماء** |
| `get_logs` | GET | آخر تعديلات الأداة (حد أقصى ١٠٠) |

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

## D1

```
tool : courier_names
type : add_courier · remove_courier · reorder_couriers   ← اتبعتت لشوبيفاي (result: success/warning/error)
       rejected                                          ← اتوقف قبل أي كتابة (result: rejected/already)
```

`value_before`/`value_after` = القايمة كاملة JSON. السجل في `log-values.json`
(`node check-log-values.mjs` لازم exit 0 قبل أي تسليم).

⛔ **قيمة `tool = 'courier_names'` لسه مش في فهرس `ecommoda-constants` §7.1**
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
| ecommoda-worker-builder | v3.9.2 |
| ecommoda-constants | v4.1.0 |

آخر تحديث: 05-10-2026 — v1.0.0 (الإطلاق الأول).
