#!/usr/bin/env bash
# Print the machine header that belongs at the top of every performance report.
# Usage: scripts/machine.sh
set -u

echo "== host =="
echo "kernel:    $(uname -srm)"
[ -r /etc/os-release ] && . /etc/os-release && echo "distro:    ${PRETTY_NAME:-unknown}"

echo
echo "== cpu =="
if command -v lscpu >/dev/null 2>&1; then
  lscpu | grep -E '^(Model name|Architecture|CPU\(s\)|Thread|Core|Socket|NUMA node\(s\)|L1d|L1i|L2|L3|CPU max MHz|CPU min MHz|Virtualization)' | sed 's/  */ /g'
else
  sysctl -n machdep.cpu.brand_string 2>/dev/null || true
  echo "logical cpus: $(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null)"
fi
echo "physical cores: $(lscpu -p=CPU,CORE 2>/dev/null | grep -v '^#' | cut -d, -f2 | sort -u | wc -l)"

echo
echo "== governor / boost =="
for p in /sys/devices/system/cpu/cpufreq/policy*/scaling_governor; do
  [ -r "$p" ] && cat "$p"
done | sort | uniq -c | sed 's/^ *//; s/^\([0-9]*\) /\1x /; s/^/governor: /'
[ -r /sys/devices/system/cpu/intel_pstate/no_turbo ] && echo "intel_pstate/no_turbo: $(cat /sys/devices/system/cpu/intel_pstate/no_turbo)"
[ -r /sys/devices/system/cpu/cpufreq/boost ] && echo "cpufreq/boost: $(cat /sys/devices/system/cpu/cpufreq/boost)"

echo
echo "== load =="
cat /proc/loadavg

echo
echo "== numa =="
if command -v numactl >/dev/null 2>&1; then numactl -H | head -n 8; else ls /sys/devices/system/node/ 2>/dev/null | grep -E '^node' || echo "single node"; fi

echo
echo "== toolchain =="
(command -v rustc >/dev/null && rustc -Vv | head -n 3) || echo "rustc not found"
(command -v cargo >/dev/null && cargo -V) || true

echo
echo "== available counters =="
if command -v perf >/dev/null 2>&1; then
  if perf stat -e instructions,cycles true >/dev/null 2>&1; then
    echo "perf: instructions/cycles available"
  else
    echo "perf: restricted (check /proc/sys/kernel/perf_event_paranoid)"
  fi
else
  echo "perf: not installed"
fi
command -v valgrind >/dev/null 2>&1 && echo "valgrind: installed (iai-callgrind usable)" || echo "valgrind: not installed (iai-callgrind needs it)"
command -v taskset >/dev/null 2>&1 && echo "taskset: installed" || true
