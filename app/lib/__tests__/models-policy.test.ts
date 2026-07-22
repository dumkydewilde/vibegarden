import { describe, expect, it } from "vitest";
import {
  defaultFreeModel,
  freeModels,
  models,
  modelsForPolicy,
  resolveClubModel,
} from "~/lib/models";

describe("club model policy", () => {
  it("limits free-only clubs to curated free models", () => {
    expect(freeModels).not.toHaveLength(0);
    expect(freeModels.every((model) => model.id.endsWith(":free"))).toBe(true);
    expect(freeModels.every((model) => model.tools)).toBe(true);
    expect(modelsForPolicy("free_only")).toEqual(freeModels);
  });

  it("gives all-model clubs the complete curated model list", () => {
    expect(modelsForPolicy("all_models")).toEqual(models);
  });

  it("uses an allowed request, then an allowed saved preference, then the policy default", () => {
    const paidModel = models.find((model) => !model.id.endsWith(":free"));
    expect(paidModel).toBeDefined();

    expect(
      resolveClubModel("all_models", paidModel!.id, defaultFreeModel.id),
    ).toEqual(paidModel);
    expect(
      resolveClubModel("free_only", paidModel!.id, defaultFreeModel.id),
    ).toEqual(defaultFreeModel);
    expect(resolveClubModel("free_only", "retired/model", paidModel!.id)).toEqual(
      defaultFreeModel,
    );
  });
});
