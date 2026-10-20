-- ============================================================================
-- Produkt i motsatt riktning: valet från admin-formuläret används.
--
-- Formuläret "Add a position" föreslår nu produkten i motsatt riktning (vald på
-- Vontobels hävstång) och skriver in raden
--   "Produkt i motsatt riktning: MFS TESLA VT2001 (hävstång 3,31 · positionens hävstång 3,28)"
-- sist i kommentaren innan positionen sparas. När positionen sparas läser
-- databasen den raden och sparar produkt och hävstång i fälten, så att
-- webbplatsen och listorna visar exakt samma val. quote-workern behöver då inte
-- räkna om (opposite_source = 'leverage').
--
-- Saknas raden (t.ex. om positionen läggs in på annat sätt) görs som förut ett
-- preliminärt val som workern sedan förfinar.
--
-- Kör efter 0010 och 0011. Säkert att köra flera gånger.
-- ============================================================================

create or replace function sitg_set_opposite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  m text[];
  manual text;
  line text;
begin
  if new.opposite_name is not null then
    return new;
  end if;

  -- 1) Raden från formuläret (eller skriven för hand) i kommentaren
  m := regexp_match(coalesce(new.note, ''), 'motsatt riktning:\s*([^\n\r(]+)', 'i');
  if m is not null then
    manual := trim(m[1]);
  end if;
  if manual is not null and manual <> '' then
    select c.isin, c.name into r from certificates_full c where upper(c.name) = upper(manual) limit 1;
    new.opposite_name := coalesce(r.name, manual);
    new.opposite_isin := r.isin;
    new.opposite_leverage := nullif(replace((regexp_match(new.note, 'motsatt riktning:[^\n\r(]*\(hävstång\s+([0-9]+(,[0-9]+)?)', 'i'))[1], ',', '.'), '')::numeric;
    new.own_leverage := nullif(replace((regexp_match(new.note, 'positionens hävstång\s+([0-9]+(,[0-9]+)?)', 'i'))[1], ',', '.'), '')::numeric;
    new.opposite_source := case when new.opposite_leverage is not null then 'leverage' else 'preliminary' end;
    return new;
  end if;

  -- 2) Ingen rad: preliminärt val som workern förfinar
  select * into r from sitg_find_opposite(new.name, new.underlying, new.leverage, new.isin);
  if found then
    new.opposite_isin := r.isin;
    new.opposite_name := r.name;
    new.opposite_source := 'preliminary';
    line := 'Produkt i motsatt riktning: ' || r.name;
    new.note := case when coalesce(trim(new.note), '') = '' then line
                     else rtrim(new.note) || E'\n\n' || line end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sitg_set_opposite on portfolio_positions;
create trigger trg_sitg_set_opposite
  before insert on portfolio_positions
  for each row execute function sitg_set_opposite();

notify pgrst, 'reload schema';
