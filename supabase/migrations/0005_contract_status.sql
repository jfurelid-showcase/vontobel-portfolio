-- ============================================================================
-- Hide knocked-out and delisted contracts from the list you pick contracts from.
--
-- Two separate switches, so one can never undo the other:
--   listed       kept up to date by the daily list import: true when the contract
--                is still in NGM's list, false once it has dropped out of it
--                (knocked out, matured or withdrawn). A contract that comes back
--                is set to true again.
--   knocked_out  set by hand (below), for a contract you know is knocked out but
--                that is still in NGM's list. The import never touches it.
--
-- The contract search only shows contracts that are listed and not knocked out.
-- Positions you already hold are NOT affected: they stay where they are.
--
-- Safe to run more than once. Run this FIRST, then deploy the new code. Until it
-- has run, everything keeps working exactly as before.
-- ============================================================================

alter table certificates_full add column if not exists listed         boolean not null default true;
alter table certificates_full add column if not exists knocked_out    boolean not null default false;
alter table certificates_full add column if not exists knocked_out_at timestamptz;

-- The contract that was reported as knocked out but still selectable:
update certificates_full
   set knocked_out = true,
       knocked_out_at = coalesce(knocked_out_at, now())
 where name ilike 'TSRT OMX VT1968';

-- To hide another one by hand later, run (change the name):
--   update certificates_full set knocked_out = true, knocked_out_at = now() where name ilike 'TSRT OMX VT1234';
-- To show one again:
--   update certificates_full set knocked_out = false, knocked_out_at = null where name ilike 'TSRT OMX VT1234';

notify pgrst, 'reload schema';
