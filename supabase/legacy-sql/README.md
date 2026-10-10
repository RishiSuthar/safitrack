# Legacy SQL (historical — do not run)

These scripts were run by hand in the Supabase SQL editor before the project
used migrations. They are kept as a record of how tables were first created,
but they are **out of date**: the live database was changed many times outside
these files, and some of them (for example `setup_multitenancy.sql`) would
re-create policies that were removed for security reasons.

The current schema lives in the Supabase project itself. Every change from
October 2026 onward is in [`../migrations/`](../migrations/), applied in
filename order.
