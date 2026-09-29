-- Run once as an administrative user (e.g. root) in MySQL Workbench:
--   File > Open SQL Script... > this file, then Query > Execute All (Ctrl+Shift+Enter).
-- Replace CHANGE_ME with a password of your own before running, and put the
-- same password in backend/.env. Do not commit the edited file.

CREATE DATABASE IF NOT EXISTS ipms
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- Disposable schema used only by the pytest MySQL integration tests.
CREATE DATABASE IF NOT EXISTS ipms_test
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- Dedicated application account: the backend never connects as root.
CREATE USER IF NOT EXISTS 'ipms_app'@'localhost' IDENTIFIED BY 'CHANGE_ME';
CREATE USER IF NOT EXISTS 'ipms_app'@'127.0.0.1' IDENTIFIED BY 'CHANGE_ME';

-- Schema privileges are needed because Alembic migrations run as this user.
GRANT ALL PRIVILEGES ON ipms.*      TO 'ipms_app'@'localhost', 'ipms_app'@'127.0.0.1';
GRANT ALL PRIVILEGES ON ipms_test.* TO 'ipms_app'@'localhost', 'ipms_app'@'127.0.0.1';
FLUSH PRIVILEGES;
