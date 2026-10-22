import { describe, expect, it } from "vitest";
import {
  calculateTailLatency,
  calculateSloBreach,
  calculateElasticity,
  calculateGini,
  calculateNormalityDiagnostics,
  calculateABTest,
  calculateOddsRatio,
} from "@/lib/stats/personas";

describe("Software Engineer Persona - Tail Latency & SLO", () => {
  it("calculates P50, P90, P99, and tail ratio accurately", () => {
    // 100 values from 10 to 100, plus high outliers
    const data = Array.from({ length: 90 }, (_, i) => 10 + i); // 10 to 99
    data.push(150, 200, 300, 450, 600, 800, 1000, 1200, 1500, 2000); // 10 spikes

    const res = calculateTailLatency(data);
    expect(res.n).toBe(100);
    expect(res.p50).toBeGreaterThanOrEqual(50);
    expect(res.p99).toBeGreaterThanOrEqual(1500);
    expect(res.tailRatio).toBeGreaterThan(10);
    expect(res.assessment).toContain("Severe tail degradation");
  });

  it("calculates SLO breach rates and budget consumption", () => {
    const latencies = [50, 60, 75, 120, 250, 350, 50, 80, 90, 110]; // 2 breaches over 200
    const res = calculateSloBreach(latencies, 200, 90.0);
    expect(res.breachCount).toBe(2);
    expect(res.actualAvailabilityPercent).toBe(80.0);
    expect(res.status).toBe("breached");
  });
});

describe("Economist Persona - Price Elasticity & Gini Inequality", () => {
  it("calculates negative price elasticity for typical downward-sloping demand", () => {
    // When price increases 10 -> 20 -> 30 -> 40, quantity drops 100 -> 80 -> 60 -> 40
    const prices = [10, 20, 30, 40];
    const quantities = [100, 80, 60, 40];

    const res = calculateElasticity(prices, quantities);
    expect(res.n).toBe(4);
    expect(res.slope).toBeCloseTo(-2.0, 5);
    expect(res.rSquared).toBeCloseTo(1.0, 5);
    // Point elasticity at mean P=25, mean Q=70: slope * (25 / 70) = -2 * (25 / 70) ≈ -0.714
    expect(res.pointElasticity).toBeCloseTo(-0.714, 2);
    expect(res.classification).toBe("Inelastic");
  });

  it("calculates Gini coefficient = 0 for perfect equality and >0.4 for concentrated income", () => {
    const equal = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100];
    expect(calculateGini(equal).gini).toBeCloseTo(0, 5);

    const unequal = [10, 15, 20, 25, 30, 40, 50, 60, 200, 800];
    const res = calculateGini(unequal);
    expect(res.gini).toBeGreaterThan(0.5);
    expect(res.top10SharePct).toBeGreaterThan(50);
  });
});

describe("Data Scientist Persona - Normality Diagnostics", () => {
  it("flags high skewness and excess kurtosis", () => {
    const rightSkewed = [1, 2, 2, 3, 3, 3, 4, 5, 20, 100];
    const res = calculateNormalityDiagnostics(rightSkewed);
    expect(res.skewness).toBeGreaterThan(1.0);
    expect(res.isNormalCandidate).toBe(false);
    expect(res.iqrOutliersCount).toBeGreaterThan(0);
  });
});

describe("Product Manager Persona - A/B Test Lift", () => {
  it("detects statistically significant lift when test is decisively higher", () => {
    // Control: 100 / 1000 = 10%
    // Test: 160 / 1000 = 16%
    const res = calculateABTest(100, 1000, 160, 1000);
    expect(res.absoluteLift).toBeCloseTo(0.06, 4);
    expect(res.relativeLiftPct).toBeCloseTo(60.0, 1);
    expect(res.isSignificant).toBe(true);
    expect(res.pValue).toBeLessThan(0.001);
  });
});

describe("Clinical Persona - Odds Ratio", () => {
  it("calculates 2x2 table odds ratio", () => {
    // a=40, b=60, c=20, d=80
    // OR = (40*80)/(60*20) = 3200 / 1200 ≈ 2.67
    const res = calculateOddsRatio(40, 60, 20, 80);
    expect(res.oddsRatio).toBeCloseTo(2.67, 2);
    expect(res.ci95Lower).toBeGreaterThan(1.0);
  });
});

