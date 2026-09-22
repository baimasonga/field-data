# Optimization contract

## Inputs

Version the sample frame, eligible targets, teams and skills, availability, modes, depot/start points, travel matrix, service-time estimates, constraints, priorities, cost model, weather/access advisories, and current assignment states.

## Output plan

Record plan ID/version, objective terms and weights, hard constraints, solver/config version, input snapshot IDs, assignments, ordering, estimated times, confidence intervals, unassigned reasons, constraint violations, approval, and superseded plan.

## Replanning policy

Define triggering events, minimum benefit threshold, freeze window for started work, reassignment notification, offline conflict resolution, and approval level. A device must reject an older plan only when the newer signed version is available and applicable.

## Evaluation

Track completion, representativeness, travel time, cost, lateness, reassignment churn, safety exceptions, collector workload distribution, estimate error, and manual override reasons. Evaluate whether optimization shifts burden unfairly.
