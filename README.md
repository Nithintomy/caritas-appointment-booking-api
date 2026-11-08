# Caritas Hospital — Concurrent Appointment Booking API

A Node.js and Express REST API backed by Microsoft SQL Server. This project was prepared for the **Caritas Hospital Node.js Backend Developer technical assessment**.

The API books an existing appointment slot for a patient and protects the slot against simultaneous booking attempts. The concurrency test runner checks both the HTTP responses and the final SQL Server database state.

## At a glance

| Item | Value |
|---|---|
| Runtime | Node.js 18 or newer |
| API framework | Express.js 4 |
| Database | Microsoft SQL Server |
| SQL driver | `mssql` |
| Booking endpoint | `POST /api/appointments/book` |
| Health endpoint | `GET /health` |
| Default API port | `3000` |
| Database name | `CaritasAppointments` |


## 1. Requirements before installation

Install or prepare the following on your Windows machine:

1. **Node.js 18 or newer.** Prefer a currently supported Node.js LTS release.
2. **Microsoft SQL Server** (Developer or Express edition is suitable for local assessment work).
3. **SQL Server Management Studio (SSMS)** or another SQL client to configure and inspect SQL Server.
4. SQL Server must accept TCP/IP connections. The default example uses port `1433`.
5. SQL Server must allow SQL Server Authentication (Mixed Mode) because the project connects with SQL logins.

If SQL Server is installed but connections fail, use SQL Server Configuration Manager to enable **TCP/IP** for your instance and restart the SQL Server service. In SSMS, check **Server Properties → Security → SQL Server and Windows Authentication mode (Mixed Mode)**; restart the service after changing the authentication mode. Use the actual SQL Server port or named instance in `.env`.

> DBeaver can be used to connect to SQL Server when its Microsoft SQL Server driver is configured. DBeaver is a database client; it does not install the SQL Server database engine. MySQL and PostgreSQL are not substitutes for SQL Server for this assessment.


## 2. Prepare the SQL Server setup login (one time)

The setup command needs a SQL Server login that can create the assessment database and create/update the separate application login.

### Option A — use the supplied SQL script

1. Open SSMS and connect to your SQL Server instance using an administrator account.
2. Open `database/00_create_logins.sql`.
3. Replace `REPLACE_WITH_A_STRONG_SETUP_PASSWORD` with a strong password.
4. Execute the script against the instance.
5. Put the resulting credentials in `.env`:

   ```env
   DB_SETUP_USER=caritas_setup
   DB_SETUP_PASSWORD=the_same_setup_password_used_in_the_sql_script
   ```

The script grants the setup login the SQL Server `dbcreator` role and `ALTER ANY LOGIN` permission. These permissions are needed by the local setup process to create the project database and provision the application login. Use this setup account only for local assessment setup and testing.

## 3. Configure `.env`

The `.env.example` file contains every environment variable used by the project. The important settings are:

```env
NODE_ENV=development
PORT=3000

DB_SERVER=localhost
DB_PORT=1433
DB_NAME=CaritasAppointments
DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=true

DB_SETUP_USER=caritas_setup
DB_SETUP_PASSWORD=your_setup_password

DB_USER=caritas_app
DB_PASSWORD=your_strong_application_password

ALLOW_TEST_RESET=false
API_BASE_URL=http://localhost:3000
TEST_PATIENT_ID_START=9001
```

- `DB_SETUP_USER` / `DB_SETUP_PASSWORD`: setup-only SQL Server credentials used by `npm run db:setup` and by the test runner for test fixture reset and database verification.
- `DB_USER` / `DB_PASSWORD`: application credentials used by the API. The setup command creates this SQL login and grants only the table permissions required by the API.
- `ALLOW_TEST_RESET`: keep this `false` except when running the supplied tests against a disposable local assessment database.

### Using a named SQL Server instance

For an instance such as `SQLEXPRESS`, comment out `DB_PORT` and set:

```env
DB_SERVER=localhost
# DB_PORT=1433
DB_INSTANCE_NAME=SQLEXPRESS
```

Use either `DB_PORT` or `DB_INSTANCE_NAME`, not both. A fixed TCP port is generally easier for repeatable local setup.

## 4. Create the database and sample data

Make sure SQL Server is running and the setup credentials in `.env` are correct. From the project root, run:

```powershell
npm run check
npm run db:setup
```

The setup command is non-destructive. It performs the following work:

1. Creates `CaritasAppointments` if it does not already exist.
2. Creates or updates the application SQL login specified by `DB_USER` / `DB_PASSWORD`.
3. Creates the database tables and indexes if they are missing.
4. Inserts the sample doctors, patients and appointment slots if they are missing.
5. Creates/maps the application database user and grants the permissions needed by the API.
6. Connects with the application login to verify database connectivity and sample data.

The setup command does **not** drop tables or delete existing appointment records. It is safe to run again for the same local assessment database.

The SQL files are also included in `database/` so the schema and seed data can be reviewed independently.

## 5. Start the API

Start the server in PowerShell:

```powershell
npm run dev
```

For a normal start without file watching:

```powershell
npm start
```

Expected startup message:

```text
Appointment API listening on port 3000
```

The API checks its SQL Server connection during startup. If it cannot connect, verify the server name, port or instance name, SQL Server authentication mode, firewall settings and `.env` credentials.


## 6. How concurrent booking is prevented

The booking service starts a SQL Server transaction and claims the requested slot using this atomic conditional update:

```sql
UPDATE dbo.AppointmentSlots
SET IsBooked = 1
OUTPUT INSERTED.SlotId
WHERE SlotId = @slotId
  AND IsBooked = 0;
```

This is not a separate availability `SELECT` followed by an `INSERT`. The conditional `UPDATE` is the atomic claim operation. When multiple transactions try to update the same available slot, SQL Server coordinates the conflicting writes with its locking mechanism. Only one transaction can change the row from `IsBooked = 0` to `IsBooked = 1`. Requests that cannot claim the row receive HTTP `409 Conflict` when the slot exists but is already booked.

The slot update and appointment insert run inside the same transaction. If the insert fails, the transaction is rolled back so the slot is not left marked as booked by a failed booking. The database also defines `UQ_Appointments_SlotId UNIQUE (SlotId)`, which prevents more than one appointment record for a slot even if another code path attempts a duplicate insert.

Together, the conditional update, transaction and unique constraint protect the slot at both the application-operation and database-constraint levels.


## 7. Submission contents

The project includes the complete Node.js source, SQL Server creation/schema/seed scripts, API implementation, concurrent test runner, test evidence and this installation guide. Keep `.env` and real credentials out of the submission. Include `.env.example` so the reviewer can configure their own SQL Server connection.
