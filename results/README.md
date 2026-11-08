# Test execution evidence

This folder contains the latest concurrency-test evidence available for this submission.

## Recorded concurrency runs

The supplied PowerShell console output shows these results:

| Concurrent requests | HTTP 201 | HTTP 409 | Unexpected responses | Checks |
|---:|---:|---:|---:|---:|
| 50 | 1 | 49 | 0 | 15 passed |
| 100 | 1 | 99 | 0 | 15 passed |

The `latest-run.json` file records the **100-request run**. Database verification reported `IsBooked = true` and exactly 1 appointment for the concurrent test slot (`SlotId = 999`).

The supplied console transcript did not include the run's timestamps or measured duration. Those fields are therefore not invented in `latest-run.json`. Re-running the test command writes a fresh report with timestamps and measured duration automatically.

## Re-run the tests

1. Start SQL Server and the API.
2. Set `ALLOW_TEST_RESET=true` in your local `.env` file. Use only a disposable local assessment database.
3. From the project root, run:

   ```powershell
   npm run test:assessment -- --requests=100
   ```

4. The test runner overwrites `latest-run.json` with the actual execution report.
5. Set `ALLOW_TEST_RESET=false` again after testing.

The test runner resets only the dedicated test slots `997`, `998`, and `999`. Do not enable test reset against production or a database containing real appointment data.
