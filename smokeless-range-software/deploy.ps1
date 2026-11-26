param(
    [ValidatePattern('^[a-zA-Z0-9_.-]+@[a-zA-Z0-9.-]+$')]
    [string]$Target = 'admin@192.168.1.194',
    [ValidatePattern('^/home/[a-zA-Z0-9_.-]+/smokeless-range-software$')]
    [string]$RemoteDir = '/home/admin/smokeless-range-software',
    [ValidatePattern('^[a-zA-Z0-9_-]+$')]
    [string]$ServiceName = 'etarget',
    [switch]$IncludeFixedCalibration,
    [string]$ResultPath
)
$ErrorActionPreference = 'Stop'
$archiveName = "shooterrange-$([Guid]::NewGuid().ToString('N')).tar.gz"
$archive = Join-Path ([IO.Path]::GetTempPath()) $archiveName
$exitCode = 1
try {
    $calibrationFiles = @()
    if ($IncludeFixedCalibration) {
        if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'fixed_calibration.json'))) {
            throw 'Requested fixed_calibration.json is missing.'
        }
        $calibrationFiles = @('fixed_calibration.json')
    }
    & tar --exclude=__pycache__ --exclude='*.pyc' -czf $archive -C $PSScriptRoot `
        app.py config.py core tests requirements.txt README.md deploy.sh deploy.ps1 find-pi.sh @calibrationFiles
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create deployment archive.' }
    $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    & scp -o StrictHostKeyChecking=yes -o ConnectTimeout=5 $archive "${Target}:$archiveName"
    if ($LASTEXITCODE -ne 0) { throw 'SCP upload failed; service was not changed.' }
    $remote = @'
set -Eeuo pipefail
target=__TARGET__
service=__SERVICE__
archive="$HOME/__ARCHIVE__"
printf '__HASH__  %s\n' "$archive" | sha256sum -c -
test "$(systemctl show "$service" --property=WorkingDirectory --value)" = "$target"
test "$(systemctl show "$service" --property=User --value)" = "$(id -un)"
python="$target/.venv/bin/python"
test -x "$python"
systemctl show "$service" --property=ExecStart --value | grep -F "$python"
stage=$(mktemp -d "$target/.deploy-stage.XXXXXXXX")
backup=$(mktemp "$target/.deploy-backup.XXXXXXXX.tar.gz")
stopped=0
had_fixed=0
test ! -f "$target/fixed_calibration.json" || had_fixed=1
cleanup() {
    case "$stage" in "$target"/.deploy-stage.*)
        find "$stage" -depth -type f -delete
        find "$stage" -depth -type d -empty -delete
        ;;
    esac
    rm -f -- "$archive"
}
rollback() {
    code=$?
    trap - ERR
    echo "DEPLOY FAILED (exit $code); backup: $backup" >&2
    if [ "$stopped" = 1 ]; then
        tar -xzf "$backup" -C "$target"
        if [ "$had_fixed" = 0 ] && [ -f "$stage/fixed_calibration.json" ]; then
            rm -f -- "$target/fixed_calibration.json"
        fi
        "$python" -m pip install -r "$target/requirements.txt"
        sudo systemctl restart "$service"
        systemctl --no-pager --lines=15 status "$service"
    fi
    exit "$code"
}
trap rollback ERR
trap cleanup EXIT
tar -xzf "$archive" -C "$stage"
backup_files=(app.py config.py core requirements.txt)
if [ "$had_fixed" = 1 ]; then backup_files+=(fixed_calibration.json); fi
tar --exclude=__pycache__ --exclude='*.pyc' -czf "$backup" -C "$target" "${backup_files[@]}"
"$python" -m pip install -r "$stage/requirements.txt"
"$python" -m unittest discover -s "$stage/tests" -p test_temporal.py -q
(cd "$stage"; "$python" tests/test_scoring.py)
"$python" -m compileall -q "$stage/app.py" "$stage/core"
(cd "$stage"; find app.py config.py core -type f -name '*.py' -print0 | sort -z | xargs -0 sha256sum) > "$stage/installed.sha256"
if [ -f "$stage/fixed_calibration.json" ]; then
    (cd "$stage"; sha256sum fixed_calibration.json) >> "$stage/installed.sha256"
fi
sudo -v
sudo systemctl stop "$service"
stopped=1
tar -xzf "$archive" -C "$target"
(cd "$target"; sha256sum -c "$stage/installed.sha256")
sudo systemctl restart "$service"
for attempt in $(seq 1 20); do
    if systemctl is-active --quiet "$service" \
        && curl -fsS --max-time 2 http://127.0.0.1:8080/api/health >/dev/null \
        && curl -fsS --max-time 2 http://127.0.0.1:8080/api/detector/status \
            | "$python" -c 'import json,sys; d=json.load(sys.stdin); assert d["available"] and d["frame_size"]' >/dev/null; then
        break
    fi
    sleep 1
done
systemctl is-active --quiet "$service"
curl -fsS --max-time 3 http://127.0.0.1:8080/api/health
curl -fsS --max-time 3 http://127.0.0.1:8080/api/detector/status \
    | "$python" -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps(d)); assert d["available"] and d["frame_size"]'
for attempt in $(seq 1 10); do
    if curl -fsS --max-time 2 http://127.0.0.1:8080/api/detector/snapshot.jpg -o "$stage/probe.jpg"; then
        break
    fi
    sleep 1
done
"$python" -c 'import cv2,sys; image=cv2.imread(sys.argv[1]); assert image is not None and image.size > 0' "$stage/probe.jpg"
systemctl --no-pager --lines=15 status "$service"
sleep 5
systemctl is-active --quiet "$service"
(cd "$target"; sha256sum -c "$stage/installed.sha256")
curl -fsS --max-time 3 http://127.0.0.1:8080/api/health
echo "DEPLOY_OK backup=$backup"
'@
    $remote = $remote.Replace('__TARGET__', $RemoteDir).Replace('__SERVICE__', $ServiceName).
        Replace('__ARCHIVE__', $archiveName).Replace('__HASH__', $hash)
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remote.Replace("`r`n", "`n")))
    # Run from a file so child processes cannot consume the deployment script's stdin.
    $remoteScript = "`$HOME/.$archiveName.sh"
    $remoteCommand = "echo $encoded | base64 -d > $remoteScript; bash $remoteScript; result=`$?; rm -f -- $remoteScript; exit `$result"
    if ($ResultPath) {
        & ssh -t -o StrictHostKeyChecking=yes -o ConnectTimeout=5 $Target $remoteCommand |
            Tee-Object -FilePath "$ResultPath.log"
    } else {
        & ssh -t -o StrictHostKeyChecking=yes -o ConnectTimeout=5 $Target $remoteCommand
    }
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) { throw "Remote deployment failed (SSH exit $exitCode)." }
} finally {
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive }
    if ($ResultPath) {
        Set-Content -LiteralPath $ResultPath -Value "Deployment SSH exit code: $exitCode" -Encoding UTF8
        Set-Content -LiteralPath "$ResultPath.exit" -Value $exitCode
    }
}
exit $exitCode
