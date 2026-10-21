# Supabase database CA

`supabase-ca-2021.crt` is a public trust certificate, not a private key.

Downloaded over verified HTTPS from the production certificate URL used by Supabase Studio:
https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Source for that URL:
https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json

SHA-256 certificate fingerprint:
`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`

Expires April 26, 2031. Review Supabase certificate rotation announcements and replace from the official source when required. The database adapter uses this CA only for Supabase database/pooler hosts and retains hostname and certificate verification. Other providers use Node's default trust roots.
