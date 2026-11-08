/* Run this script after 02_create_tables.sql in CaritasAppointments.*/
SET NOCOUNT ON;

IF NOT EXISTS (SELECT 1 FROM dbo.Doctors WHERE DoctorId = 201)
    INSERT INTO dbo.Doctors (DoctorId, DoctorName, Specialization)
    VALUES (201, N'Dr. Anil Kumar', N'General Medicine');

IF NOT EXISTS (SELECT 1 FROM dbo.Doctors WHERE DoctorId = 202)
    INSERT INTO dbo.Doctors (DoctorId, DoctorName, Specialization)
    VALUES (202, N'Dr. Meera Thomas', N'Cardiology');

;WITH PatientNumbers AS
(
    SELECT 1 AS N
    UNION ALL
    SELECT N + 1 FROM PatientNumbers WHERE N < 100
)
INSERT INTO dbo.Patients (PatientId, PatientName, Email)
SELECT 5000 + N,
       CONCAT(N'Assessment Patient ', N),
       CONCAT(N'assessment.patient.', N, N'@example.test')
FROM PatientNumbers AS p
WHERE NOT EXISTS (SELECT 1 FROM dbo.Patients AS existing WHERE existing.PatientId = 5000 + p.N)
OPTION (MAXRECURSION 100);

;WITH TestPatientNumbers AS
(
    SELECT 1 AS N
    UNION ALL
    SELECT N + 1 FROM TestPatientNumbers WHERE N < 100
)
INSERT INTO dbo.Patients (PatientId, PatientName, Email)
SELECT 9000 + N,
       CONCAT(N'Concurrent Test Patient ', N),
       CONCAT(N'concurrent.patient.', N, N'@example.test')
FROM TestPatientNumbers AS p
WHERE NOT EXISTS (SELECT 1 FROM dbo.Patients AS existing WHERE existing.PatientId = 9000 + p.N)
OPTION (MAXRECURSION 100);

INSERT INTO dbo.AppointmentSlots (SlotId, DoctorId, StartTime, EndTime, IsBooked)
SELECT seed.SlotId, seed.DoctorId, seed.StartTime, seed.EndTime, 0
FROM (VALUES
    (101, 201, CAST('2027-01-10T09:00:00' AS DATETIME2(0)), CAST('2027-01-10T09:15:00' AS DATETIME2(0))),
    (102, 202, CAST('2027-01-10T09:00:00' AS DATETIME2(0)), CAST('2027-01-10T09:30:00' AS DATETIME2(0))),
    (997, 201, CAST('2027-01-11T10:00:00' AS DATETIME2(0)), CAST('2027-01-11T10:15:00' AS DATETIME2(0))),
    (998, 201, CAST('2027-01-11T10:30:00' AS DATETIME2(0)), CAST('2027-01-11T10:45:00' AS DATETIME2(0))),
    (999, 202, CAST('2027-01-11T11:00:00' AS DATETIME2(0)), CAST('2027-01-11T11:30:00' AS DATETIME2(0)))
) AS seed (SlotId, DoctorId, StartTime, EndTime)
WHERE NOT EXISTS (SELECT 1 FROM dbo.AppointmentSlots AS existing WHERE existing.SlotId = seed.SlotId);
GO

PRINT 'Seed data is ready. Sample booking: SlotId=101, PatientId=5001.';
PRINT 'Test runner uses test-only slots 997, 998 and 999.';
