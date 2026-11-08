/* Run this script after selecting the CaritasAppointments database. It is non-destructive. */
IF OBJECT_ID(N'dbo.Doctors', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Doctors
    (
        DoctorId       INT            NOT NULL CONSTRAINT PK_Doctors PRIMARY KEY,
        DoctorName     NVARCHAR(100)  NOT NULL,
        Specialization NVARCHAR(100)  NOT NULL
    );
END;
GO

IF OBJECT_ID(N'dbo.Patients', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Patients
    (
        PatientId   INT            NOT NULL CONSTRAINT PK_Patients PRIMARY KEY,
        PatientName NVARCHAR(100)  NOT NULL,
        Email       NVARCHAR(150)  NOT NULL,
        CONSTRAINT UQ_Patients_Email UNIQUE (Email)
    );
END;
GO

IF OBJECT_ID(N'dbo.AppointmentSlots', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AppointmentSlots
    (
        SlotId     INT          NOT NULL CONSTRAINT PK_AppointmentSlots PRIMARY KEY,
        DoctorId   INT          NOT NULL,
        StartTime  DATETIME2(0) NOT NULL,
        EndTime    DATETIME2(0) NOT NULL,
        IsBooked   BIT          NOT NULL CONSTRAINT DF_AppointmentSlots_IsBooked DEFAULT (0),
        CONSTRAINT FK_AppointmentSlots_Doctors
            FOREIGN KEY (DoctorId) REFERENCES dbo.Doctors(DoctorId),
        CONSTRAINT CK_AppointmentSlots_TimeRange CHECK (EndTime > StartTime)
    );
END;
GO

IF OBJECT_ID(N'dbo.Appointments', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Appointments
    (
        AppointmentId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Appointments PRIMARY KEY,
        SlotId        INT              NOT NULL,
        PatientId     INT              NOT NULL,
        BookedAt      DATETIME2(0)     NOT NULL CONSTRAINT DF_Appointments_BookedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT UQ_Appointments_SlotId UNIQUE (SlotId),
        CONSTRAINT FK_Appointments_Slot
            FOREIGN KEY (SlotId) REFERENCES dbo.AppointmentSlots(SlotId),
        CONSTRAINT FK_Appointments_Patient
            FOREIGN KEY (PatientId) REFERENCES dbo.Patients(PatientId)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_AppointmentSlots_Doctor_StartTime' AND object_id = OBJECT_ID(N'dbo.AppointmentSlots'))
BEGIN
    CREATE INDEX IX_AppointmentSlots_Doctor_StartTime
        ON dbo.AppointmentSlots (DoctorId, StartTime);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Appointments_PatientId' AND object_id = OBJECT_ID(N'dbo.Appointments'))
BEGIN
    CREATE INDEX IX_Appointments_PatientId
        ON dbo.Appointments (PatientId);
END;
GO

PRINT 'Tables and indexes are ready. Existing tables were not dropped.';
