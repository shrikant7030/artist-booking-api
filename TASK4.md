# Task 4 — System Design

`GET /artists/search` times out after growth from 1,000 to 50,000 users. MySQL CPU is at 90%
at peak. 48 hours, no downtime.

## 1. Two most likely causes, and what I check first

The search predicates probably are not indexed in a way MySQL can use. A name match with a
leading wildcard (`LIKE '%term%'`) cannot use a B-tree at all, so every request scans the
table. Fifty times the rows, scanned fifty times as often, is where the timeout comes from.

The other likely cause is N+1 queries behind the endpoint: one query for the page, then one
per result for rating, profile or next-available slot. Harmless at 1,000 users, thousands of
round trips a second at peak.

To tell which, I would read `performance_schema.events_statements_summary_by_digest` ordered
by total latency. That shows the statement actually consuming the CPU, not just the slowest
single run. Then `EXPLAIN` it: `type: ALL` with rows examined far above rows returned points
at the index problem, while a huge execution count on a trivial query points at the N+1.

## 2. The 48-hour fix

Add the composite index the predicate needs, online with `ALGORITHM=INPLACE, LOCK=NONE`, so
nothing goes offline. Then cache the endpoint response for 60 seconds, keyed on the
normalised query. Search traffic repeats heavily, with a handful of filter combinations
dominating, so a short TTL absorbs most of it while staying fresh. Both are reversible the
same day.

## 3. The long-term fix

Move search to a dedicated engine such as OpenSearch, fed by change-data-capture from MySQL,
and leave MySQL to serve booking writes. Relevance, faceting and geo filters are what it is
built for, and search stops competing with bookings for the same CPU.

The trade-off is eventual consistency, since a new artist takes seconds to become
searchable, plus another system to run, secure and reindex. Search tolerates staleness;
taking a booking does not.
