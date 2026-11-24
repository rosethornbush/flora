import { PIIDetector } from "@mastra/core/processors";

import { model } from "../model";

export const pii = new PIIDetector({
  model,
  strategy: "redact",
  redactionMethod: "placeholder",
  errorStrategy: "strict",
  detectionTypes: [
    "name",
    "email",
    "phone",
    "address",
    "date-of-birth",
    "ssn",
    "credit-card",
    "api-key",
  ],
});
