/**
 * Synthetic sample dataset — generated deterministically from a fixed seed.
 * It represents no real people or organisations.
 */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export const SAMPLE_NAME = "synthetic-community-survey.csv";

export function sampleCsv(): string {
  const rand = lcg(42);
  const regions = ["North", "South", "East", "West", "Central"];
  const channels = ["Radio", "Online", "Friend", "Clinic"];
  const lines = ["respondent_id,region,age,household_size,monthly_income,heard_via,satisfaction,survey_date"];
  for (let i = 1; i <= 60; i++) {
    const region = regions[Math.floor(rand() * regions.length)];
    const age = rand() < 0.07 ? "" : String(18 + Math.floor(rand() * 55));
    const hh = String(1 + Math.floor(rand() * 7));
    // right-skewed income
    const income = rand() < 0.1 ? "" : String(Math.round(150 + Math.pow(rand(), 2) * 1800));
    const channel = rand() < 0.05 ? "" : channels[Math.floor(rand() * channels.length)];
    const sat = String(1 + Math.floor(rand() * 5));
    const day = String(1 + Math.floor(rand() * 28)).padStart(2, "0");
    const month = String(1 + Math.floor(rand() * 6)).padStart(2, "0");
    lines.push([`R${String(i).padStart(3, "0")}`, region, age, hh, income, channel, sat, `2026-${month}-${day}`].join(","));
  }
  return lines.join("\n");
}
