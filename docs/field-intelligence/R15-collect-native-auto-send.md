# R15: Stock Collect native auto-send setup

Fieldwork now prepares a private project settings QR for stock ODK Collect. The
collector explicitly selects manual, Wi-Fi, cellular, or Wi-Fi and cellular
sending and acknowledges the credential and project before displaying it.
`delete_send: false` retains sent instances on the device. Form update mode and
administrator restrictions are not changed by this configuration.

Apply the QR inside the intended existing Collect project's settings and confirm
the resulting server and network policy in Collect. Creating a new project does
not migrate another project's queued instances. On one device, use Collect's
image import with a privately saved QR image, then delete that saved image.

The QR carries the connected App User credential and project server URL. It is
created only on explicit request, never logged by the QR component even with
developer tools enabled, and removed from the DOM after two minutes, a network
policy change, consent withdrawal, page hiding, or disconnect. It is not saved
by Fieldwork. Hiding a QR does not revoke its credential or delete an image saved
by the user; revoke the App User key through the server when required.

Collect owns native scheduling, network constraints, retries and per-instance
queue status. The browser cannot confirm settings were applied or inspect
Collect's private Android queue. Existing server receipts indicate received
submissions, and R14 verifies exact received XML and file bytes; neither reports
unsent instances. This implementation adds no Android application or private
provider access, as required by the selected client architecture.

Compatibility source: getodk/collect commit
`e008fbcf5dd4e957d513760c9001707f8cf75989`,
`settings/src/main/java/org/odk/collect/settings/keys/ProjectKeys.kt`,
`settings/src/main/res/values/strings.xml`, and
`collect_app/src/main/java/org/odk/collect/android/instancemanagement/send/autosend/AutoSendSettingsProvider.kt`.
The native settings are `general.server_url`, `general.autosend` (`off`,
`wifi_only`, `cellular_only`, `wifi_and_cellular`) and `general.delete_send`.
The QR uses Collect's compressed JSON/base64 format with `project` and `admin`.

Validation covers real QR decoding for all four policies, explicit consent,
policy change and timeout cleanup, hidden page cleanup, narrow mobile layout,
and credential logging suppression. Physical-device application, OS background
scheduling and real Wi-Fi/cellular transitions remain pilot acceptance tasks.
