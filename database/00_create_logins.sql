/*
  Run once in SSMS as a SQL Server administrator.
  Replace the password placeholder before execution.

  This creates only the setup login. The application login configured by
  DB_USER / DB_PASSWORD is created automatically by `npm run db:setup`.
*/
USE master;
GO

IF SUSER_ID(N'caritas_setup') IS NULL
BEGIN
    CREATE LOGIN [caritas_setup]
        WITH PASSWORD = N'REPLACE_WITH_A_STRONG_SETUP_PASSWORD',
             CHECK_POLICY = ON,
             CHECK_EXPIRATION = OFF;
END;
GO

IF IS_SRVROLEMEMBER(N'dbcreator', N'caritas_setup') <> 1
BEGIN
    ALTER SERVER ROLE [dbcreator] ADD MEMBER [caritas_setup];
END;
GO

GRANT ALTER ANY LOGIN TO [caritas_setup];
GO

PRINT 'Setup login caritas_setup is ready.';
PRINT 'It can create databases and provision the application login.';
