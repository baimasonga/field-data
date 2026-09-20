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
Submission version should replace its existing spreadsheet row.

Client secrets and refresh tokens are encrypted before they are stored and are
never returned by the API. The integration shows only a short credential hint.
Delivery results are available under the integration's **Details** action.

The integration handles new events after it is enabled. It does not backfill
historical Submissions.

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
