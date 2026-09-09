---
kind: event
name: final_corrective_requested
title: Final approval gate change requested
description: The operator wants changes before the project concludes, and the pipeline must turn the objection into corrective work.
signal_payload:
  reason:
    required: true
    description: A short write-up — Observed / Diagnosis / Fixed when — that keeps the operator's own words intact rather than replacing or paraphrasing them. Becomes a finding in the final review report and frames the corrective.
---

Fires when the operator asks for changes at the final approval gate rather than approving or rejecting. The reason carries a short write-up, grounded before it is drafted, that preserves the operator's own words rather than paraphrasing them away — the pipeline records it as a finding on the running final review report and births a corrective against it, so anything paraphrased away is lost to the coder who works the request. Several concerns raised in one request are one finding and therefore one corrective; signal once, with all of them. The final reviewer is not re-dispatched — the corrective's own work is the next action, and the approval gate comes back around when it closes.
