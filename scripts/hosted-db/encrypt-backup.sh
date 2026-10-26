#!/usr/bin/env bash
# Local only, never contacts a database. Packs a rehearsal folder (the Production backup plus its checksums and
# metadata) into one AES-256 encrypted file next to it, then proves it can be recovered: it decrypts the file again
# and compares the archive hash and every backup checksum. The passphrase is typed twice at a hidden prompt and
# handed to gpg through a file descriptor, so it never appears in a command line, the environment or a log.
#   bash scripts/hosted-db/encrypt-backup.sh ~/aladdin-production-rehearsal-<date>
# Output: <folder>.tar.gpg and <folder>.tar.gpg.sha256 beside the folder. The folder itself is only read.
# Keep the passphrase in your password manager: without it the file cannot be recovered.
set -euo pipefail
export LC_ALL=C
DIR="${1:?usage: encrypt-backup.sh <rehearsal folder>}"; DIR="$(cd "$DIR" && pwd)"
[ -s "$DIR/backup/SHA256SUMS" ] || { echo "$DIR/backup/SHA256SUMS missing: not a rehearsal folder"; exit 1; }
command -v gpg >/dev/null || { echo "gpg not found (Git for Windows ships it in Git Bash)"; exit 1; }
( cd "$DIR/backup" && shasum -a 256 -c --quiet SHA256SUMS ) || { echo "backup checksums do not match: stopping"; exit 1; }
OUTF="$DIR.tar.gpg"; [ ! -e "$OUTF" ] || { echo "$OUTF already exists: stopping (nothing overwritten)"; exit 1; }
umask 077
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# The report files (counts and hashes) and the backup; the throwaway restore copies are left out.
( cd "$(dirname "$DIR")" && tar -cf "$TMP/a.tar" --exclude="$(basename "$DIR")/restore" "$(basename "$DIR")" )
TARSUM="$(shasum -a 256 "$TMP/a.tar" | cut -d' ' -f1)"
read -r -s -p "Backup passphrase (hidden): " P1; echo
read -r -s -p "Repeat the passphrase: " P2; echo
[ "$P1" = "$P2" ] || { echo "passphrases differ: stopping"; exit 1; }
[ "${#P1}" -ge 16 ] || { echo "use at least 16 characters: stopping"; exit 1; }
gpg() { command gpg --batch --quiet --no-symkey-cache --pinentry-mode loopback --passphrase-fd 3 "$@" 3< <(printf '%s' "$P1"); }
gpg --symmetric --cipher-algo AES256 --s2k-digest-algo SHA512 --s2k-count 65011712 --compress-algo none -o "$OUTF" "$TMP/a.tar"
unset P2
# Recovery proof: decrypt into the temporary folder and compare.
gpg --decrypt -o "$TMP/check.tar" "$OUTF"
[ "$(shasum -a 256 "$TMP/check.tar" | cut -d' ' -f1)" = "$TARSUM" ] || { echo "decrypted archive differs: do not rely on $OUTF"; exit 1; }
mkdir "$TMP/x"; tar -xf "$TMP/check.tar" -C "$TMP/x"
( cd "$TMP/x/$(basename "$DIR")/backup" && shasum -a 256 -c --quiet SHA256SUMS ) || { echo "backup checksums inside the archive differ"; exit 1; }
unset P1
( cd "$(dirname "$OUTF")" && shasum -a 256 "$(basename "$OUTF")" > "$(basename "$OUTF").sha256" )
chmod 400 "$OUTF" "$OUTF.sha256" 2>/dev/null || true
echo "Encrypted backup: $OUTF ($(wc -c < "$OUTF" | tr -d ' ') bytes)"
echo "Checksum file:    $OUTF.sha256 ($(cut -d' ' -f1 "$OUTF.sha256"))"
echo "Recovery check: decrypted again, archive hash and all backup checksums match."
echo "Recover later with: gpg --decrypt -o backup.tar \"$(basename "$OUTF")\" && tar -xf backup.tar"
