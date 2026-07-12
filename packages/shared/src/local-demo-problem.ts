export interface LocalDemoProblemExample {
  input: string;
  output: string;
}

export interface LocalDemoProblemTestcase {
  nums: number[];
  target: number;
  expected: number[];
}

export interface LocalDemoProblem {
  title: string;
  difficulty: string;
  prompt: string;
  examples: LocalDemoProblemExample[];
  testcases: LocalDemoProblemTestcase[];
  constraints: string[];
}

export const localDemoProblem: LocalDemoProblem = {
  title: "Two Sum",
  difficulty: "Easy",
  prompt:
    "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.",
  examples: [
    {
      input: "nums = [2,7,11,15], target = 9",
      output: "[0,1]",
    },
    {
      input: "nums = [3,2,4], target = 6",
      output: "[1,2]",
    },
  ],
  testcases: [
    {
      nums: [2, 7, 11, 15],
      target: 9,
      expected: [0, 1],
    },
    {
      nums: [3, 2, 4],
      target: 6,
      expected: [1, 2],
    },
    {
      nums: [3, 3],
      target: 6,
      expected: [0, 1],
    },
  ],
  constraints: ["2 <= nums.length <= 10^4", "-10^9 <= nums[i] <= 10^9", "Exactly one valid answer exists."],
};

export const localDemoStarterCode = `function twoSum(nums, target) {
  const seen = new Map();

  for (let index = 0; index < nums.length; index += 1) {
    const complement = target - nums[index];
    if (seen.has(complement)) {
      return [seen.get(complement), index];
    }
    seen.set(nums[index], index);
  }

  return [];
}

console.log(JSON.stringify(twoSum([2, 7, 11, 15], 9)));
`;
