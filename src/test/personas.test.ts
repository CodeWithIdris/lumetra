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

  it("uses fractional request-volume error budgets and leaves no-data results undefined", () => {
    const result = calculateSloBreach([50, 100, 150], 100, 90);
    expect(result.n).toBe(3);
    expect(result.compliantCount).toBe(2);
    expect(result.budgetTotalAllowedBreaches).toBeCloseTo(0.3, 12);
    expect(result.budgetConsumedPercent).toBeCloseTo(100 / 0.3, 10);
    expect(result.status).toBe("breached");
    expect(calculateSloBreach([], 100).actualAvailabilityPercent).toBeNull();
    expect(calculateSloBreach([], 100).status).toBe("unavailable");
  });

  it("documents type-7 tail percentiles and mean absolute successive jitter", () => {
    const result = calculateTailLatency([40, 10, 30, 20]);
    expect(result.p50).toBe(25);
    expect(result.p75).toBe(32.5);
    expect(result.p90).toBe(37);
    expect(result.p95).toBe(38.5);
    expect(result.p99).toBeCloseTo(39.7, 12);
    expect(result.p999).toBeCloseTo(39.97, 12);
    expect(result.jitter).toBeCloseTo(20, 12);
    expect(calculateTailLatency([7]).jitter).toBeNull();
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
    expect(res.arcElasticity).toBeNull();
  });

  it("calculates Gini coefficient = 0 for perfect equality and >0.4 for concentrated income", () => {
    const equal = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100];
    expect(calculateGini(equal).gini).toBeCloseTo(0, 5);

    const unequal = [10, 15, 20, 25, 30, 40, 50, 60, 200, 800];
    const res = calculateGini(unequal);
    expect(res.gini).toBeGreaterThan(0.5);
    expect(res.top10SharePct).toBeGreaterThan(50);
  });

  it("uses exact population slices for quintiles and the top decile", () => {
    const result = calculateGini([6, 1, 5, 2, 4, 3]);
    expect(result.gini).toBeCloseTo(35 / 126, 12);
    expect(result.quintiles.map((q) => q.sharePct)).toEqual([
      expect.closeTo((1.2 / 21) * 100, 10),
      expect.closeTo((2.8 / 21) * 100, 10),
      expect.closeTo((4.2 / 21) * 100, 10),
      expect.closeTo((5.6 / 21) * 100, 10),
      expect.closeTo((7 / 21) * 100, 10),
    ]);
    expect(result.top10SharePct).toBeCloseTo((3.6 / 21) * 100, 10);
    expect(result.palmaRatio).toBeCloseTo(0.9, 10);
  });

  it("does not silently drop negative incomes or invent positive-only Gini estimates", () => {
    const result = calculateGini([-1, 0, 1, 2, 3, 4]);
    expect(result.n).toBe(6);
    expect(result.gini).toBeNull();
    expect(result.rating).toContain("Negative values are present");
    expect(calculateGini([0, 0, 0, 0, 0]).palmaRatio).toBeNull();
  });
});

describe("Data Scientist Persona - Normality Diagnostics", () => {
  it("flags high skewness and excess kurtosis", () => {
    const rightSkewed = [1, 2, 2, 3, 3, 3, 4, 5, 20, 100];
    const res = calculateNormalityDiagnostics(rightSkewed);
    expect(res.skewness).toBeGreaterThan(1.0);
    expect(res.momentsNearNormal).toBe(false);
    expect(res.iqrOutliersCount).toBeGreaterThan(0);
    expect(res.recommendation).toContain("not a formal normality test");
  });

  it("uses biased population central moments and does not infer normality from a small sample", () => {
    const result = calculateNormalityDiagnostics([1, 2, 3, 4]);
    expect(result.skewness).toBeCloseTo(0, 12);
    expect(result.kurtosis).toBeCloseTo(-1.36, 12);
    expect(result.momentsNearNormal).toBe(false);
    expect(calculateNormalityDiagnostics([1, 2, 3]).skewness).toBeNull();
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
    expect(res.confidenceInterval95?.[0]).toBeCloseTo(0.0306, 3);
    expect(res.confidenceInterval95?.[1]).toBeCloseTo(0.0894, 3);
    expect(res.note).toContain("pooled score z-test");
  });

  it("does not convert zero denominators or undefined relative lift to zero", () => {
    expect(calculateABTest(0, 0, 1, 10).pValue).toBeNull();
    const baselineZero = calculateABTest(0, 100, 10, 100);
    expect(baselineZero.absoluteLift).toBeCloseTo(0.1, 12);
    expect(baselineZero.relativeLiftPct).toBeNull();
    expect(baselineZero.note).toContain("below 5");
    expect(calculateABTest(0, 10, 0, 10).confidenceInterval95).toBeNull();
    expect(calculateABTest(11, 10, 0, 10).absoluteLift).toBeNull();
  });
});

describe("Clinical Persona - Odds Ratio", () => {
  it("calculates 2x2 table odds ratio", () => {
    // a=40, b=60, c=20, d=80
    // OR = (40*80)/(60*20) = 3200 / 1200 ≈ 2.67
    const res = calculateOddsRatio(40, 60, 20, 80);
    expect(res.oddsRatio).toBeCloseTo(2.67, 2);
    expect(res.ci95Lower).toBeGreaterThan(1.0);
    expect(res.relativeRisk).toBeCloseTo(2, 12);
    expect(res.note).toContain("uncorrected");
    expect(res.interpretation).toContain("not evidence of causation");
  });

  it("uses a disclosed zero-cell correction and leaves zero-margin estimates undefined", () => {
    const corrected = calculateOddsRatio(0, 10, 5, 5);
    expect(corrected.oddsRatio).toBeCloseTo((0.5 * 5.5) / (10.5 * 5.5), 12);
    expect(corrected.note).toContain("Haldane");
    const undefinedResult = calculateOddsRatio(0, 0, 3, 4);
    expect(undefinedResult.oddsRatio).toBeNull();
    expect(undefinedResult.relativeRisk).toBeNull();
    expect(undefinedResult.chiSquareP).toBeNull();
  });
});
