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
