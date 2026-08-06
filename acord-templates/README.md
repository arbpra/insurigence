# Official ACORD form templates

Drop the agency's **licensed fillable ACORD PDF** here to have the app fill and
export the official branded form instead of the generated data PDF.

## How it works

- File name must match the form type: `ACORD_125.pdf`, `ACORD_126.pdf`,
  `ACORD_140.pdf`, `ACORD_25.pdf`, `ACORD_130.pdf`.
- The template must be a **fillable PDF** (AcroForm with named text fields).
- On export, if a template exists for the form type, the app fills its form
  fields from the mapped data. If not, it falls back to the generated PDF.

## Wiring the field names

Every official ACORD PDF uses its own internal AcroForm field names. Map our
data keys to those names in `lib/acord/templateMap.ts`.

To discover a template's field names, run:

```
npx tsx script/list-acord-fields.ts ACORD_125
```

This prints every fillable field name in `ACORD_125.pdf`, which you then map to
our keys (namedInsured, mailingAddress, …) in `templateMap.ts`.

## Legal note

ACORD forms are copyrighted/licensed. Only place templates here that the agency
is licensed to use.
