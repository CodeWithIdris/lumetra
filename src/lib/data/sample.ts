/**
 * Deterministic sample datasets tailored for user personas.
 * Generated from fixed PRNG seeds so results are repeatable, auditable and private.
 */
import type { PersonaId } from "../stats/personas";

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
  const lines = [
    "respondent_id,region,age,household_size,monthly_income,heard_via,satisfaction,survey_date",
  ];
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
    lines.push(
      [
        `R${String(i).padStart(3, "0")}`,
        region,
        age,
        hh,
        income,
        channel,
        sat,
        `2026-${month}-${day}`,
      ].join(","),
    );
  }
  return lines.join("\n");
}

export function sampleEngineerCsv(): string {
  const rand = lcg(101);
  const services = ["auth-service", "payment-api", "user-gateway", "search-worker"];
  const lines = ["timestamp,service,endpoint,latency_ms,qps,status_code,cpu_percent,memory_mb"];
  for (let i = 1; i <= 80; i++) {
    const service = services[Math.floor(rand() * services.length)]!;
    const endpoint =
      service === "payment-api"
        ? "/v1/charge"
        : service === "auth-service"
          ? "/oauth/token"
          : "/api/query";
    // Base latency with heavy tail / occasional spikes
    const isSpike = rand() < 0.12;
    const baseLatency = 20 + Math.floor(rand() * 45);
    const latency = isSpike ? baseLatency + Math.floor(180 + rand() * 420) : baseLatency;
    const qps = Math.floor(120 + rand() * 600);
    const statusCode = latency > 300 && rand() < 0.35 ? 504 : rand() < 0.04 ? 500 : 200;
    const cpu = (15 + (latency / 600) * 60 + rand() * 15).toFixed(1);
    const mem = Math.floor(256 + rand() * 320);
    const minute = String(Math.floor(i / 2) % 60).padStart(2, "0");
    const hour = String(10 + Math.floor(i / 120)).padStart(2, "0");
    lines.push(
      [
        `2026-10-22T${hour}:${minute}:00Z`,
        service,
        endpoint,
        latency,
        qps,
        statusCode,
        cpu,
        mem,
      ].join(","),
    );
  }
  return lines.join("\n");
}

export function sampleEconomistCsv(): string {
  const rand = lcg(202);
  const quarters = [
    "2023-Q1",
    "2023-Q2",
    "2023-Q3",
    "2023-Q4",
    "2024-Q1",
    "2024-Q2",
    "2024-Q3",
    "2024-Q4",
    "2025-Q1",
    "2025-Q2",
    "2025-Q3",
    "2025-Q4",
    "2026-Q1",
    "2026-Q2",
    "2026-Q3",
    "2026-Q4",
  ];
  const countries = ["Alpha Republic", "Beta Union", "Gamma Isle", "Delta Federation"];
  const lines = [
    "country,quarter,gdp_growth_pct,inflation_pct,policy_rate_pct,unemployment_pct,price_index,consumer_demand_index",
  ];
  for (const country of countries) {
    let price = 100;
    let demand = 1000;
    for (const q of quarters) {
      const gdp = (-1.2 + rand() * 5.4).toFixed(2);
      const inflation = (1.5 + rand() * 6.2).toFixed(2);
      const rate = (0.5 + rand() * 5.0).toFixed(2);
      const unemp = (3.4 + rand() * 4.8).toFixed(2);
      // Realistic inverse price vs demand
      price += Math.round((rand() - 0.3) * 6);
      demand = Math.round(1000 - (price - 100) * 6.8 + (rand() - 0.5) * 40);
      lines.push([country, q, gdp, inflation, rate, unemp, price, Math.max(200, demand)].join(","));
    }
  }
  return lines.join("\n");
}

export function sampleScientistCsv(): string {
  const rand = lcg(303);
  const lines = [
    "customer_id,age,monthly_spend,tenure_months,support_tickets,usage_hours,churn_risk_score",
  ];
  for (let i = 1; i <= 75; i++) {
    const id = `CUST-${1000 + i}`;
    const age = Math.floor(21 + rand() * 48);
    // Skewed spend
    const monthlySpend = (25 + Math.pow(rand(), 2.2) * 450).toFixed(2);
    const tenure = Math.floor(1 + rand() * 48);
    const tickets = rand() < 0.6 ? 0 : Math.floor(1 + rand() * 6);
    const usage = (5 + rand() * 85).toFixed(1);
    const churn = Math.min(
      1,
      Math.max(0, 0.1 + tickets * 0.14 - tenure * 0.005 + rand() * 0.15),
    ).toFixed(3);
    lines.push([id, age, monthlySpend, tenure, tickets, usage, churn].join(","));
  }
  return lines.join("\n");
}

export function sampleProductCsv(): string {
  const rand = lcg(404);
  const lines = [
    "user_id,variant,device,sessions,checkout_completed,revenue_usd,onboarding_time_sec",
  ];
  for (let i = 1; i <= 100; i++) {
    const uid = `USR-${5000 + i}`;
    const variant = i % 2 === 0 ? "control" : "treatment_v2";
    const device = rand() < 0.6 ? "mobile" : "desktop";
    const sessions = Math.floor(1 + rand() * 8);
    // Treatment has ~14% higher conversion
    const convProb = variant === "treatment_v2" ? 0.28 : 0.17;
    const converted = rand() < convProb ? 1 : 0;
    const revenue = converted ? (18 + Math.floor(rand() * 85)).toFixed(2) : "0.00";
    const time = Math.floor(45 + rand() * 180);
    lines.push([uid, variant, device, sessions, converted, revenue, time].join(","));
  }
  return lines.join("\n");
}

export function sampleClinicalCsv(): string {
  const rand = lcg(505);
  const cohorts = ["Placebo", "Treatment_Low", "Treatment_High"];
  const lines = [
    "subject_id,cohort,age,baseline_biomarker,week_12_biomarker,responder,adverse_event",
  ];
  for (let i = 1; i <= 60; i++) {
    const id = `SUBJ-${200 + i}`;
    const cohort = cohorts[i % 3]!;
    const age = Math.floor(35 + rand() * 40);
    const baseline = (45 + rand() * 30).toFixed(1);
    const reduction =
      cohort === "Treatment_High"
        ? 18 + rand() * 12
        : cohort === "Treatment_Low"
          ? 8 + rand() * 8
          : rand() * 4;
    const week12 = Math.max(10, parseFloat(baseline) - reduction).toFixed(1);
    const responder = parseFloat(week12) < 40 ? 1 : 0;
    const adverse = cohort === "Treatment_High" && rand() < 0.18 ? 1 : rand() < 0.05 ? 1 : 0;
    lines.push([id, cohort, age, baseline, week12, responder, adverse].join(","));
  }
  return lines.join("\n");
}

export function sampleCsvForPersona(persona: PersonaId): { name: string; csv: string } {
  switch (persona) {
    case "engineer":
      return { name: "microservice-telemetry.csv", csv: sampleEngineerCsv() };
    case "economist":
      return { name: "macro-economic-indicators.csv", csv: sampleEconomistCsv() };
    case "scientist":
      return { name: "customer-churn-features.csv", csv: sampleScientistCsv() };
    case "product":
      return { name: "ab-experiment-conversions.csv", csv: sampleProductCsv() };
    case "clinical":
      return { name: "clinical-trial-outcomes.csv", csv: sampleClinicalCsv() };
    default:
      return { name: SAMPLE_NAME, csv: sampleCsv() };
  }
}
