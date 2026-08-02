-- Migration: enable required Postgres extensions.
-- This is the ONLY schema change shipped by the foundation task. No product
-- tables are created without an approved specification (ADR-0002).
--
-- Extensions live in the dedicated `extensions` schema (Supabase convention),
-- not `public`.

create schema if not exists extensions;

-- gen_random_uuid(), crypto helpers — used for primary keys.
create extension if not exists pgcrypto with schema extensions;

-- Trigram similarity for fuzzy search (Smart Search).
create extension if not exists pg_trgm with schema extensions;

-- Vector similarity for embeddings / RAG (retrieval must still apply
-- authorization filters before returning rows — see docs/security/rls-strategy.md).
create extension if not exists vector with schema extensions;

-- Geospatial queries (locality/coverage). Enable now; use where geo is required.
create extension if not exists postgis with schema extensions;
