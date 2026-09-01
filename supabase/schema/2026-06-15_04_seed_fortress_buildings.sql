-- 2026-06-15_04: seed the 39 remaining Fortress portfolio sites as GMI buildings.
-- AbaQulusi Plaza (the 40th) already exists and was linked in _03. These 39 come
-- from the insight-linker "Fortress_Fund" client
-- (id eec20f09-6a02-42de-b151-cbe5c7b665c8, 40 sites total) so Fortress operational
-- reports can be authored for the whole portfolio. Each row carries il_site_id (the
-- insight-linker public.sites.id) so the live FDW read (_05) auto-fills the
-- shop / breaker / meter / CT data + inspection photos.
--
--   org    = derived from the existing AbaQulusi building (linked in _03), so the 39
--            land in the SAME org as the existing Fortress building. This is portable
--            across prod and staging (whose "Building Ops" org ids differ) — do NOT
--            hardcode the org id. If the AbaQulusi anchor is absent the seed no-ops.
--   type   = 'retail'  (matches AbaQulusi / the proven Fortress-report path;
--                        insight-linker site_type is unpopulated, so no better signal)
--   id     = gen_random_uuid() (default); created_at/updated_at default now().
--            il_site_id is the stable join key, not id.
--
-- DEPENDS ON _03 (needs the il_site_id column, its partial unique index, and the
-- AbaQulusi anchor backfill). Idempotent: ON CONFLICT (il_site_id) DO NOTHING.
-- Additive. Applied staging -> prod.

INSERT INTO public.buildings (organization_id, name, address, building_type, il_site_id)
SELECT aba.organization_id, v.name, v.address, 'retail', v.il_site_id::uuid
  FROM (VALUES
    ('204 Oxford', '204 Oxford Rd, Illovo, Sandton, Gauteng', '45c4171e-b4b6-4aa4-a563-d71314c2db4b'),
    ('36 Houer Road City Deep', '36 Houer Road, City Deep, Gauteng', '4a0d11fb-e08e-47dd-bde5-5fc7849d9310'),
    ('60 Electron Avenue Isando', '60 Electron Avenue, Isando, Kempton Park, Gauteng', 'dba098a6-d3ca-422a-97da-9fde6a8df3f9'),
    ('Biyela Shopping Centre', '3 Biyela Street, KwaZulu-Natal', 'd4bca5d1-d963-4cac-bcc5-292fb6095cf1'),
    ('Biyela Square', 'Byrne Street, KwaZulu-Natal', '5b618cee-4c8b-468e-b798-009748d0b698'),
    ('Bloemfontein Value Mart', 'Cnr Vereeniging & Curie Roads, Bloemfontein, Free State', '1fc2bf7e-a044-471f-8833-0b3da43db107'),
    ('Botlokwa Plaza', 'Cnr N1 & Ramakgopa Road, Matoks, Limpopo', 'eb4e1052-d8fd-43fc-94c2-2cb7e86403a7'),
    ('Central Park Bloemfontein', '1 Hanger Street, Free State', '2327f587-1d65-44f0-947c-7cf7b5f7eb32'),
    ('Crossroads Plaza', '37 Moloto Road, Mpumalanga', '2e959108-a9f6-4c27-8ea7-dd2a50c23a13'),
    ('Cullinan Office Park', '35 Cullinan Cl, Morningside, Sandton, Gauteng', '59e0256e-6b67-43c2-ae62-824996e13a31'),
    ('Equinox Mall Jeffreys Bay', '59 St Francis St, Pellsrus, Jeffreys Bay, Eastern Cape', 'b60ba713-9216-4ead-90cd-fd83f1567200'),
    ('Evaton Mall', 'Golden Hwy, Evaton West, Evaton, Gauteng', 'ef460dee-8a5c-4234-ade8-e3a8978f03e8'),
    ('Flamwood Value Centre', '1 Brother Patrick Rd, Flamwood, Klerksdorp, North West', '659455eb-ca60-49a0-97b0-0b28bcd82002'),
    ('Flamwood Walk', '1 Brother Patrick Rd, Flamwood, Klerksdorp, North West', 'bec27946-5691-4e5e-bb02-4dec3969e120'),
    ('Fortune Street City Deep', 'Fortune Street, Gauteng', '81a1ec73-9fd4-4368-8394-60da34338263'),
    ('Fourways Value Mart', 'Shop 21, Fourways Value Mart Centre, Forest Dr, Lone Hill, Sandton, Gauteng', '6d60f106-b07d-4372-8278-e1e834a87409'),
    ('Kopano (Morone) Shopping Centre', 'Kastania Street, Limpopo', '835bccac-ac6a-49e6-8d17-8d07ebd4c5ec'),
    ('Lebowakgomo Shopping Centre', 'Jane Furse Road, Limpopo', '8c840f67-ccde-452f-aa18-c1acf1130e65'),
    ('Mafikeng (Mahikeng) Station', '3845 Station Road, North West', '4bb5e71c-d264-414f-af8a-eea11294daed'),
    ('Maple Industrial Park, Pomona', '36 Maple Road, Gauteng', 'bc5cfd1f-a3f7-458f-961b-6aadc592ef6a'),
    ('Mayville Mall', 'Crn Van Rensburg Street & Nienaber Ave, Mayville, Pretoria, Gauteng', '66de070d-7e3b-4790-865b-f926b8e3a294'),
    ('Mirabel Industrial Park Pomona', '2 Maple Road, Kempton Park, Gauteng', '5d472374-66d1-499f-89bb-e6bb405995e4'),
    ('Monument Centre', 'Cnr Beyers Naude and Burger Street, Standerton, Mpumalanga', '0053aa4c-7aed-42dd-abf6-2bd9ab2e9676'),
    ('Mutsindo Mall & Capricorn Plaza', 'Mutsindo street, Limpopo', '1a9462d8-6ab8-4934-8783-fbb51806b4a6'),
    ('Palm Springs', 'R155 and Falcon Road, Orange Farm, Vereeniging, Gauteng', '79e8cacd-9b97-4991-b7b4-874656677b78'),
    ('Park Central', 'Cnr Noord & Twist, Joubert Park, Johannesburg, Gauteng', 'c5e1048d-d8d2-476d-bbc2-693ba9b6ee0d'),
    ('Pineslopes Shopping Centre', 'Corner Witkoppen & The Straight, Fourways, Gauteng', '34ebd3a5-8d7e-4919-8f12-da507d5760e4'),
    ('Rustenburg Plaza', '36B Fatima Bhayat St, Rustenburg, North West', 'a8772009-c38a-4690-9a50-75546e0defab'),
    ('Shoprite Kokstad', 'Shoprite Centre, 43 Hope St, Kokstad, KwaZulu-Natal', '7bb16eeb-7321-4c52-b21f-8d46216a7b65'),
    ('Sterkspruit Plaza', '230 Umlamli Road, Sterkspruit, Eastern Cape', '4af30183-fdaf-4b78-8367-abf89e77234f'),
    ('The Plaza', 'Cnr Henshall and Bester Street, Mbombela, Mpumalanga', '54e4c958-8749-48e1-8972-a0430af0e783'),
    ('Thembi Mall', 'Sheba Street, Tembisa, Gauteng', 'd2146674-0010-4af0-b66a-99dd69a69b55'),
    ('Tlokwe Street Louwlardia', 'Tlokwe Street Louwlardia, Gauteng', '6b31b9bd-81e4-4a0e-9134-716fdfbf4a73'),
    ('Venda Plaza', 'Main Road, Limpopo', 'c318ba55-801e-492d-82f9-cb9c1db08e8e'),
    ('Village Walk Newcastle', 'Harding Street, KwaZulu-Natal', '5a62373c-a051-4d73-aac9-be6302477cde'),
    ('Weskus Mall', '110 Saldanha Road, Vredenburg, Western Cape', '1d7bb958-bd19-4292-bba5-57214c67e5c8'),
    ('White River Crossing', 'CNR R537 & R40, White River, Mpumalanga', '82d25ae1-6541-4a64-a036-ac14a6460991'),
    ('YARONA CENTRE', 'Tigerfish Street, Kaalfontein, Midrand, Gauteng', 'ade5256f-419e-4860-bfd4-2f38dc3cb21a'),
    ('York Road City Centre', 'Sutherland Street, Eastern Cape', 'c70acee6-5528-41a4-ac07-9ae7e75135ff')
  ) AS v(name, address, il_site_id)
  CROSS JOIN (
    SELECT organization_id
      FROM public.buildings
     WHERE il_site_id = '16729bf2-d71b-40d1-b8c6-b57d1cadd46a'
     LIMIT 1
  ) AS aba
ON CONFLICT (il_site_id) WHERE il_site_id IS NOT NULL DO NOTHING;
