/* Run this script while connected to the master database. */
IF DB_ID(N'CaritasAppointments') IS NULL
BEGIN
    CREATE DATABASE CaritasAppointments;
END;
GO
