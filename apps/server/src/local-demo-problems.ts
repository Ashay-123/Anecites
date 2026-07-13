import {
  localDemoProblem,
  localDemoStarterCode,
  type LocalDemoProblemExample,
  type LocalDemoProblemTestcase,
} from "@anecites/shared";

export interface LocalDemoProblemSeed {
  slug: string;
  title: string;
  difficulty: string;
  prompt: string;
  starterCode: string;
  functionName: string;
  languageId: number;
  examples: readonly LocalDemoProblemExample[];
  constraints: readonly string[];
  testcases: readonly LocalDemoProblemSeedTestcase[];
}

export interface LocalDemoProblemSeedTestcase extends LocalDemoProblemTestcase {
  hidden?: boolean;
}

export const localDemoProblemSeeds = [
  {
    slug: "local-demo-two-sum-javascript",
    title: localDemoProblem.title,
    difficulty: localDemoProblem.difficulty,
    prompt: localDemoProblem.prompt,
    starterCode: localDemoStarterCode,
    functionName: "twoSum",
    languageId: 63,
    examples: localDemoProblem.examples,
    constraints: localDemoProblem.constraints,
    testcases: [
      ...localDemoProblem.testcases,
      {
        nums: [0, 4, 3, 0],
        target: 0,
        expected: [0, 3],
        hidden: true,
      },
    ],
  },
  {
    slug: "local-demo-product-pair-javascript",
    title: "Product Pair",
    difficulty: "Easy",
    prompt:
      "Given an array of integers nums and an integer target, return indices of two numbers whose product equals target.",
    starterCode: `function productPair(nums, target) {
  const seen = new Map();

  for (let index = 0; index < nums.length; index += 1) {
    const value = nums[index];
    if (value !== 0 && target % value === 0 && seen.has(target / value)) {
      return [seen.get(target / value), index];
    }
    if (target === 0 && seen.has(0)) {
      return [seen.get(0), index];
    }
    seen.set(value, index);
  }

  return [];
}

console.log(JSON.stringify(productPair([2, 4, 6, 8], 48)));
`,
    functionName: "productPair",
    languageId: 63,
    examples: [
      {
        input: "nums = [2,4,6,8], target = 48",
        output: "[2,3]",
      },
      {
        input: "nums = [3,5,7], target = 15",
        output: "[0,1]",
      },
    ],
    testcases: [
      {
        nums: [2, 4, 6, 8],
        target: 48,
        expected: [2, 3],
      },
      {
        nums: [3, 5, 7],
        target: 15,
        expected: [0, 1],
      },
      {
        nums: [9, 2, 6],
        target: 18,
        expected: [0, 1],
        hidden: true,
      },
    ],
    constraints: ["2 <= nums.length <= 10^4", "-10^6 <= nums[i] <= 10^6", "Exactly one valid answer exists."],
  },
] as const satisfies readonly LocalDemoProblemSeed[];

export const defaultLocalDemoProblemSlug = localDemoProblemSeeds[0].slug;
