-- Adds members.pincode (design_handoff_flexhub_v2/README.md §3 "Add/Edit Member": a
-- separate 6-digit Pincode field above the residential address textarea).
--
-- Nullable, no format CHECK — same convention as the other optional identity fields on
-- this table (aadhaar_number, occupation): format validation lives client-side only
-- (services/member.service.ts's PINCODE_REGEX), matching how phone's 10-digit format is
-- also client-validated only, with the DB only enforcing what it actually must (here,
-- nothing beyond "it's text" - there's no uniqueness or cross-row constraint to protect).

alter table members add column if not exists pincode text;
