# Google Sheets integration

Field Data can append each new Submission to a Google worksheet and can update
the same row when that Submission receives a new version. The first delivery to
an empty worksheet writes stable XML field paths as column headings. The
Submission instance ID is kept in the first column and is used to prevent an
updated Submission from becoming a duplicate row.

## Google setup

1. Enable the Google Sheets API in a Google Cloud project.
2. Create an OAuth 2.0 client and authorize a Google account with offline access
   and the `https://www.googleapis.com/auth/spreadsheets` scope.
3. Keep the resulting client ID, client secret, and refresh token. Ensure the
   authorized Google account can edit the destination spreadsheet.
4. Copy the spreadsheet ID from the URL between `/d/` and `/edit`, and note the
   exact worksheet tab name.

In Field Data, open **Field Data → Integrations**, select **Google Sheets**,
choose a Form, and enter those values. Enable update synchronization if a new
Submission version should replace its existing spreadsheet row. Select **send
existing Submissions** to queue a historical synchronization immediately, or
use **Sync existing submissions** from the integration's Details later.

Client secrets and refresh tokens are encrypted before they are stored and are
never returned by the API. The integration shows only a short credential hint.
Delivery results and historical-sync progress are available under the
integration's **Details** action. Historical work runs in batches of ten and
continues in the background, so closing the browser does not stop it. A partial
run can retry only its failed rows. A pending run can be cancelled.

If Google rejects the refresh token, the integration is marked as needing
reauthorization. Replace both OAuth credentials in Details, then retry the
failed synchronization. Stored credentials are never displayed again.

## What has been checked, and what has not

The requests this integration builds were sent to the live Google endpoints
with deliberately invalid credentials, and the token exchange came back
`invalid_client` — a complaint about the credential, not about the request, so
the endpoint understands the form it is sent. The paths, parameters and
response shapes are pinned in tests against Google's own machine-readable
discovery document rather than against anybody's reading of the guide.

Values are written with `valueInputOption=RAW`. The alternative, `USER_ENTERED`,
parses each value as though a person had typed it, which would turn an answer
beginning with `=` into a live formula in the spreadsheet. RAW stores what it
is given, and a test exists to keep it that way.

What none of that shows is whether an authorised request behaves as documented.
Google checks credentials before it validates a range, so an unauthenticated
probe cannot confirm that a range is acceptable — a deliberately malformed one
is refused identically. The first real spreadsheet is still the first real
test of that, and the place to watch is the delivery log.

## What it costs, and what it will not do

A new Submission reads a single cell of the worksheet — enough to tell whether
the header row still has to be written — and then appends one row. That is the
same work whether the sheet holds ten rows or a hundred thousand.

Update synchronization is the expensive case. To replace a Submission's
existing row the integration has to find it, and the Sheets API cannot search,
so the instance-ID column is read in windows of ten thousand rows until the ID
turns up. The row number is re-derived from the sheet every time rather than
remembered, which is what keeps an update from overwriting the wrong row after
somebody inserts a row by hand.

An append whose response is lost is not simply retried: the sheet is asked
whether the row arrived, because a retry that was already committed would write
it twice. A delivery confirmed that way is logged as "Delivered (confirmed in
sheet)".

Editing the worksheet by hand is allowed but not free. Removing a row means a
later update for that Submission appends a new one instead. Leaving blank cells
in the instance-ID column can end the search early, with the same result.
