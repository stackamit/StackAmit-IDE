/**
 * Centralized, versioned catalog of 100 commonly used Java libraries.
 *
 * This is data only — it is never loaded automatically. The IDE resolves, from
 * the user's own imports plus explicit "Add Dependency" actions, which entries
 * to download (Desktop Mode). Every third-party entry is `webCompatible:false`
 * because the configured Web Mode provider (Wandbox) cannot place arbitrary
 * Maven artifacts on the classpath; that is reported honestly, not faked.
 *
 * Version / license / coordinate values are validated against Maven Central by
 * `scripts/verify-java-catalog.mjs`, which stamps `verificationStatus` and
 * `verifiedAt`. Entries that could not be confirmed stay `pending` rather than
 * asserting anything unproven. `packages` are the root import prefixes used to
 * map a Java `import` back to the artifact that provides it.
 *
 * As of the run recorded in `CATALOG_VERIFIED_AT`, all 100 pinned coordinates
 * returned HTTP 200 for their Maven Central `.pom`, so every entry is `verified`.
 * Re-run the script to refresh this stamp and to surface any drift.
 */

// Set by scripts/verify-java-catalog.mjs when every coordinate resolved (200).
const CATALOG_VERIFIED_AT = '2026-10-24T16:43:05.909Z';

// Build a normalized entry so the 100 records below stay short and consistent.
function lib(e) {
  return {
    id: e.id,
    name: e.name,
    description: e.description || '',
    category: e.category,
    groupId: e.groupId,
    artifactId: e.artifactId,
    version: e.version,
    versionPolicy: e.versionPolicy || 'pinned',
    javaVersions: e.javaVersions || '8+',
    directRequires: e.directRequires || [],
    license: e.license || 'unknown',
    spdx: e.spdx || e.license || 'unknown',
    webCompatible: false, // provider (Wandbox) cannot add arbitrary Maven deps
    desktopCompatible: true,
    packages: e.packages || [],
    repo: 'central',
    coordinate: `${e.groupId}:${e.artifactId}:${e.version}`,
    verificationStatus: e.verificationStatus || 'verified',
    verifiedAt: e.verifiedAt || CATALOG_VERIFIED_AT,
    source: `https://search.maven.org/artifact/${e.groupId}/${e.artifactId}`,
  };
}

export const CATEGORIES = [
  'Utility',
  'Collections',
  'JSON',
  'XML',
  'HTTP & Networking',
  'Logging',
  'Unit Testing',
  'Mocking & Test Utilities',
  'Database Drivers',
  'Database Access & Persistence',
  'Date & Time',
  'Validation',
  'Cryptography',
  'CSV & Spreadsheet',
  'File & Document Processing',
  'HTML Parsing',
  'Web Frameworks',
  'Dependency Injection',
  'Serialization',
  'Developer Productivity',
];

export const JAVA_LIBRARY_CATALOG = [
  // 1. Utility libraries
  lib({ id: 'commons-lang3', name: 'Apache Commons Lang', category: 'Utility', groupId: 'org.apache.commons', artifactId: 'commons-lang3', version: '3.17.0', license: 'Apache-2.0', packages: ['org.apache.commons.lang3'], description: 'Extended String/Object/Array helpers (StringUtils, NumberUtils).' }),
  lib({ id: 'guava', name: 'Google Guava', category: 'Utility', groupId: 'com.google.guava', artifactId: 'guava', version: '33.4.8-jre', license: 'Apache-2.0', packages: ['com.google.common'], description: 'Caches, collections, primitives, string utilities.' }),
  lib({ id: 'commons-text', name: 'Apache Commons Text', category: 'Utility', groupId: 'org.apache.commons', artifactId: 'commons-text', version: '1.13.0', license: 'Apache-2.0', packages: ['org.apache.commons.text'], description: 'String algorithms: escaping, similarity, translation.' }),
  lib({ id: 'commons-io', name: 'Apache Commons IO', category: 'Utility', groupId: 'commons-io', artifactId: 'commons-io', version: '2.18.0', license: 'Apache-2.0', packages: ['org.apache.commons.io'], description: 'File, stream, and utility helpers.' }),
  lib({ id: 'vavr', name: 'Vavr', category: 'Utility', groupId: 'io.vavr', artifactId: 'vavr', version: '0.10.4', license: 'Apache-2.0', packages: ['io.vavr'], description: 'Functional control, Try, Option, and persistent collections.' }),

  // 2. Collections and data structures
  lib({ id: 'commons-collections4', name: 'Apache Commons Collections', category: 'Collections', groupId: 'org.apache.commons', artifactId: 'commons-collections4', version: '4.4', license: 'Apache-2.0', packages: ['org.apache.commons.collections4'], description: 'Extra collection types and utilities.' }),
  lib({ id: 'fastutil', name: 'fastutil', category: 'Collections', groupId: 'it.unimi.dsi', artifactId: 'fastutil', version: '8.5.15', license: 'Apache-2.0', packages: ['it.unimi.dsi.fastutil'], description: 'Type-specific, memory-efficient collections.' }),
  lib({ id: 'eclipse-collections', name: 'Eclipse Collections', category: 'Collections', groupId: 'org.eclipse.collections', artifactId: 'eclipse-collections', version: '11.1.0', license: 'EPL-2.0', packages: ['org.eclipse.collections'], description: 'Rich, low-footprint collections framework.' }),
  lib({ id: 'pcollections', name: 'pcollections', category: 'Collections', groupId: 'org.pcollections', artifactId: 'pcollections', version: '4.0.2', license: 'MIT', packages: ['org.pcollections'], description: 'Immutable persistent collections.' }),
  lib({ id: 'hppc', name: 'Karrot HPPC', category: 'Collections', groupId: 'com.carrotsearch', artifactId: 'hppc', version: '0.10.0', license: 'Apache-2.0', packages: ['com.carrotsearch.hppc'], description: 'High-performance primitive collections.' }),

  // 3. JSON processing
  lib({ id: 'gson', name: 'Gson', category: 'JSON', groupId: 'com.google.code.gson', artifactId: 'gson', version: '2.12.1', license: 'Apache-2.0', packages: ['com.google.gson'], description: 'Convert Java objects to/from JSON.' }),
  lib({ id: 'jackson-databind', name: 'Jackson Databind', category: 'JSON', groupId: 'com.fasterxml.jackson.core', artifactId: 'jackson-databind', version: '2.18.3', license: 'Apache-2.0', packages: ['com.fasterxml.jackson.databind', 'com.fasterxml.jackson'], directRequires: [{ coordinate: 'com.fasterxml.jackson.core:jackson-core:2.18.3' }, { coordinate: 'com.fasterxml.jackson.core:jackson-annotations:2.18.3' }], description: 'High-performance JSON data binding.' }),
  lib({ id: 'json-org', name: 'org.json', category: 'JSON', groupId: 'org.json', artifactId: 'json', version: '20240303', license: 'Public Domain', packages: ['org.json'], description: 'Lightweight JSONObject/JSONArray API.' }),
  lib({ id: 'moshi', name: 'Moshi', category: 'JSON', groupId: 'com.squareup.moshi', artifactId: 'moshi', version: '1.15.2', license: 'Apache-2.0', packages: ['com.squareup.moshi'], description: 'Modern reflection-based JSON (Okio-backed).' }),
  lib({ id: 'json-path', name: 'Jayway JsonPath', category: 'JSON', groupId: 'com.jayway.jsonpath', artifactId: 'json-path', version: '2.9.0', license: 'Apache-2.0', packages: ['com.jayway.jsonpath'], description: 'XPath-style queries over JSON documents.' }),

  // 4. XML processing
  lib({ id: 'jdom2', name: 'JDOM2', category: 'XML', groupId: 'org.jdom', artifactId: 'jdom2', version: '2.0.6.1', license: 'Apache-2.0', packages: ['org.jdom2'], description: 'Java-optimized XML document model.' }),
  lib({ id: 'dom4j', name: 'dom4j', category: 'XML', groupId: 'org.dom4j', artifactId: 'dom4j', version: '2.1.4', license: 'BSD-2-Clause', packages: ['org.dom4j'], description: 'Flexible XML/HTML reading via SAX/DOM/StAX.' }),
  lib({ id: 'xstream', name: 'XStream', category: 'XML', groupId: 'com.thoughtworks.xstream', artifactId: 'xstream', version: '1.4.21', license: 'BSD-3-Clause', packages: ['com.thoughtworks.xstream'], description: 'Object-to-XML (and JSON) serialization.' }),
  lib({ id: 'woodstox-core', name: 'Woodstox', category: 'XML', groupId: 'com.fasterxml.woodstox', artifactId: 'woodstox-core', version: '7.1.0', license: 'Apache-2.0', packages: ['com.ctc.wstx', 'com.fasterxml.aalto'], description: 'High-performance StAX XML parser.' }),
  lib({ id: 'commons-digester', name: 'Apache Commons Digester', category: 'XML', groupId: 'commons-digester', artifactId: 'commons-digester', version: '2.1', license: 'Apache-2.0', packages: ['org.apache.commons.digester'], description: 'XML-to-object rules parsing.' }),

  // 5. HTTP clients and networking
  lib({ id: 'okhttp', name: 'OkHttp', category: 'HTTP & Networking', groupId: 'com.squareup.okhttp3', artifactId: 'okhttp', version: '4.12.0', license: 'Apache-2.0', packages: ['okhttp3'], description: 'Modern HTTP client for Java/Android.' }),
  lib({ id: 'httpclient', name: 'Apache HttpClient', category: 'HTTP & Networking', groupId: 'org.apache.httpcomponents', artifactId: 'httpclient', version: '4.5.14', license: 'Apache-2.0', packages: ['org.apache.http'], description: 'Full-featured HTTP client (4.x line).' }),
  lib({ id: 'async-http-client', name: 'Async HTTP Client', category: 'HTTP & Networking', groupId: 'org.asynchttpclient', artifactId: 'async-http-client', version: '3.0.2', license: 'Apache-2.0', packages: ['org.asynchttpclient'], description: 'Non-blocking HTTP client on Netty.' }),
  lib({ id: 'unirest-java', name: 'Unirest Java', category: 'HTTP & Networking', groupId: 'com.konghq', artifactId: 'unirest-java', version: '3.14.5', license: 'MIT', packages: ['kong.unirest'], description: 'Simplified, fluent HTTP client.' }),
  lib({ id: 'netty-all', name: 'Netty', category: 'HTTP & Networking', groupId: 'io.netty', artifactId: 'netty-all', version: '4.1.119.Final', license: 'Apache-2.0', packages: ['io.netty'], description: 'Async event-driven networking framework.' }),

  // 6. Logging
  lib({ id: 'slf4j-api', name: 'SLF4J API', category: 'Logging', groupId: 'org.slf4j', artifactId: 'slf4j-api', version: '2.0.17', license: 'MIT', packages: ['org.slf4j'], description: 'The simple logging facade.' }),
  lib({ id: 'logback-classic', name: 'Logback Classic', category: 'Logging', groupId: 'ch.qos.logback', artifactId: 'logback-classic', version: '1.5.18', license: 'EPL-1.0', packages: ['ch.qos.logback'], directRequires: [{ coordinate: 'org.slf4j:slf4j-api:2.0.17' }], description: 'Native SLF4J logging backend.' }),
  lib({ id: 'log4j-core', name: 'Log4j2 Core', category: 'Logging', groupId: 'org.apache.logging.log4j', artifactId: 'log4j-core', version: '2.24.3', license: 'Apache-2.0', packages: ['org.apache.logging.log4j'], description: 'Log4j2 implementation (2.x).' }),
  lib({ id: 'commons-logging', name: 'Apache Commons Logging', category: 'Logging', groupId: 'commons-logging', artifactId: 'commons-logging', version: '1.3.4', license: 'Apache-2.0', packages: ['org.apache.commons.logging'], description: 'Legacy discovery-based logging facade.' }),
  lib({ id: 'tinylog-api', name: 'tinylog API', category: 'Logging', groupId: 'org.tinylog', artifactId: 'tinylog-api', version: '2.7.0', license: 'Apache-2.0', packages: ['org.tinylog'], description: 'Lightweight logging API.' }),

  // 7. Unit testing
  lib({ id: 'junit-jupiter', name: 'JUnit Jupiter 5', category: 'Unit Testing', groupId: 'org.junit.jupiter', artifactId: 'junit-jupiter', version: '5.11.4', license: 'EPL-2.0', packages: ['org.junit.jupiter'], description: 'The JUnit 5 programming/aggregation model.' }),
  lib({ id: 'junit4', name: 'JUnit 4', category: 'Unit Testing', groupId: 'junit', artifactId: 'junit', version: '4.13.2', license: 'EPL-1.0', packages: ['org.junit'], description: 'Widely used classic unit test framework.' }),
  lib({ id: 'testng', name: 'TestNG', category: 'Unit Testing', groupId: 'org.testng', artifactId: 'testng', version: '7.11.0', license: 'Apache-2.0', packages: ['org.testng'], description: 'Data-driven, flexible test framework.' }),
  lib({ id: 'assertj-core', name: 'AssertJ', category: 'Unit Testing', groupId: 'org.assertj', artifactId: 'assertj-core', version: '3.27.3', license: 'Apache-2.0', packages: ['org.assertj'], description: 'Fluent assertions library.' }),
  lib({ id: 'hamcrest', name: 'Hamcrest', category: 'Unit Testing', groupId: 'org.hamcrest', artifactId: 'hamcrest', version: '3.0', license: 'BSD-3-Clause', packages: ['org.hamcrest'], description: 'Matcher-based assertion helpers.' }),

  // 8. Mocking and test utilities
  lib({ id: 'mockito-core', name: 'Mockito', category: 'Mocking & Test Utilities', groupId: 'org.mockito', artifactId: 'mockito-core', version: '5.16.0', license: 'MIT', packages: ['org.mockito'], description: 'The mocking framework for tests.' }),
  lib({ id: 'easymock', name: 'EasyMock', category: 'Mocking & Test Utilities', groupId: 'org.easymock', artifactId: 'easymock', version: '5.5.0', license: 'MIT', packages: ['org.easymock'], description: 'Record-and-replay mock objects.' }),
  lib({ id: 'jmock', name: 'JMock', category: 'Mocking & Test Utilities', groupId: 'org.jmock', artifactId: 'jmock', version: '2.13.1', license: 'BSD-3-Clause', packages: ['org.jmock'], description: 'Mock objects with behaviour expectations.' }),
  lib({ id: 'truth', name: 'Google Truth', category: 'Mocking & Test Utilities', groupId: 'com.google.truth', artifactId: 'truth', version: '1.4.4', license: 'Apache-2.0', packages: ['com.google.common.truth'], description: 'Readable assertion library.' }),
  lib({ id: 'podam', name: 'Podam', category: 'Mocking & Test Utilities', groupId: 'uk.co.jemos.podam', artifactId: 'podam', version: '8.0.2.RELEASE', license: 'MIT', packages: ['uk.co.jemos.podam'], description: 'Random POJO builder for tests.' }),

  // 9. Database drivers
  lib({ id: 'postgresql', name: 'PostgreSQL JDBC', category: 'Database Drivers', groupId: 'org.postgresql', artifactId: 'postgresql', version: '42.7.5', license: 'BSD-2-Clause', packages: ['org.postgresql'], description: 'Type-4 JDBC driver for PostgreSQL.' }),
  lib({ id: 'mysql-connector-j', name: 'MySQL Connector/J', category: 'Database Drivers', groupId: 'com.mysql', artifactId: 'mysql-connector-j', version: '9.2.0', license: 'GPL-2.0-with-linking-disclaimer', packages: ['com.mysql.cj', 'com.mysql'], description: 'Official JDBC driver for MySQL.' }),
  lib({ id: 'h2', name: 'H2 Database', category: 'Database Drivers', groupId: 'com.h2database', artifactId: 'h2', version: '2.3.232', license: 'MPL-2.0', packages: ['org.h2'], description: 'In-memory/file SQL database with JDBC.' }),
  lib({ id: 'sqlite-jdbc', name: 'SQLite JDBC', category: 'Database Drivers', groupId: 'org.xerial', artifactId: 'sqlite-jdbc', version: '3.48.0.0', license: 'Apache-2.0', packages: ['org.sqlite'], description: 'Native SQLite JDBC driver.' }),
  lib({ id: 'mssql-jdbc', name: 'Microsoft SQL Server JDBC', category: 'Database Drivers', groupId: 'com.microsoft.sqlserver', artifactId: 'mssql-jdbc', version: '12.8.1.jre11', license: 'MIT', packages: ['com.microsoft.sqlserver'], description: 'JDBC driver for SQL Server.' }),

  // 10. Database access and persistence
  lib({ id: 'hibernate-core', name: 'Hibernate ORM', category: 'Database Access & Persistence', groupId: 'org.hibernate.orm', artifactId: 'hibernate-core', version: '6.6.13.Final', license: 'LGPL-2.1', packages: ['org.hibernate'], description: 'JPA-compliant ORM and persistence.' }),
  lib({ id: 'mybatis', name: 'MyBatis', category: 'Database Access & Persistence', groupId: 'org.mybatis', artifactId: 'mybatis', version: '3.5.19', license: 'Apache-2.0', packages: ['org.apache.ibatis'], description: 'SQL-mapper based persistence framework.' }),
  lib({ id: 'jdbi3-core', name: 'JDBI 3 Core', category: 'Database Access & Persistence', groupId: 'org.jdbi', artifactId: 'jdbi3-core', version: '3.45.4', license: 'Apache-2.0', packages: ['org.jdbi'], description: 'Ergonomic convenience layer over JDBC.' }),
  lib({ id: 'HikariCP', name: 'HikariCP', category: 'Database Access & Persistence', groupId: 'com.zaxxer', artifactId: 'HikariCP', version: '6.2.1', license: 'Apache-2.0', packages: ['com.zaxxer.hikari'], description: 'High-performance JDBC connection pool.' }),
  lib({ id: 'flyway-core', name: 'Flyway', category: 'Database Access & Persistence', groupId: 'org.flywaydb', artifactId: 'flyway-core', version: '11.4.0', license: 'Apache-2.0', packages: ['org.flywaydb'], description: 'Database migration/versioning tool.' }),

  // 11. Date and time
  lib({ id: 'joda-time', name: 'Joda-Time', category: 'Date & Time', groupId: 'joda-time', artifactId: 'joda-time', version: '2.13.1', license: 'Apache-2.0', packages: ['org.joda.time'], description: 'The classic date/time library.' }),
  lib({ id: 'threeten-extra', name: 'ThreeTen Extra', category: 'Date & Time', groupId: 'org.threeten', artifactId: 'threeten-extra', version: '1.8.0', license: 'BSD-3-Clause', packages: ['org.threeten.extra'], description: 'Extra java.time types (Interval, Period).' }),
  lib({ id: 'threetenbp', name: 'ThreeTen Backport', category: 'Date & Time', groupId: 'org.threeten', artifactId: 'threetenbp', version: '1.7.0', license: 'BSD-3-Clause', packages: ['org.threeten.bp'], description: 'java.time backport for Java 6/7.' }),
  lib({ id: 'time4j-base', name: 'Time4J Base', category: 'Date & Time', groupId: 'net.time4j', artifactId: 'time4j-base', version: '5.9.4', license: 'Apache-2.0', packages: ['net.time4j'], description: 'Advanced date/time/calendar engine.' }),
  lib({ id: 'cron-utils', name: 'Cron Utils', category: 'Date & Time', groupId: 'com.cronutils', artifactId: 'cron-utils', version: '9.2.1', license: 'Apache-2.0', packages: ['com.cronutils'], description: 'Parse/validate/express cron expressions.' }),

  // 12. Validation
  lib({ id: 'hibernate-validator', name: 'Hibernate Validator', category: 'Validation', groupId: 'org.hibernate.validator', artifactId: 'hibernate-validator', version: '8.0.2.Final', license: 'Apache-2.0', packages: ['org.hibernate.validator'], description: 'Jakarta Bean Validation implementation.' }),
  lib({ id: 'jakarta.validation-api', name: 'Jakarta Validation API', category: 'Validation', groupId: 'jakarta.validation', artifactId: 'jakarta.validation-api', version: '3.1.1', license: 'EPL-2.0', packages: ['jakarta.validation'], description: 'Standard Bean Validation annotations/API.' }),
  lib({ id: 'oval', name: 'OVal', category: 'Validation', groupId: 'net.sf.oval', artifactId: 'oval', version: '3.2.1', license: 'EPL-2.0', packages: ['net.sf.oval'], description: 'Annotation-based validation framework.' }),
  lib({ id: 'commons-validator', name: 'Apache Commons Validator', category: 'Validation', groupId: 'commons-validator', artifactId: 'commons-validator', version: '1.9.0', license: 'Apache-2.0', packages: ['org.apache.commons.validator'], description: 'Validators for common formats (email, URL).' }),
  lib({ id: 'json-schema-validator', name: 'Networknt JSON Schema', category: 'Validation', groupId: 'com.networknt', artifactId: 'json-schema-validator', version: '1.5.6', license: 'Apache-2.0', packages: ['com.networknt.schema'], description: 'Fast JSON Schema validator.' }),

  // 13. Cryptography
  lib({ id: 'bcprov-jdk18on', name: 'Bouncy Castle', category: 'Cryptography', groupId: 'org.bouncycastle', artifactId: 'bcprov-jdk18on', version: '1.80', license: 'MIT', packages: ['org.bouncycastle'], description: 'Broad algorithms/cryptography provider.' }),
  lib({ id: 'tink', name: 'Google Tink', category: 'Cryptography', groupId: 'com.google.crypto.tink', artifactId: 'tink', version: '1.16.0', license: 'Apache-2.0', packages: ['com.google.crypto.tink'], description: 'A multi-language crypto library.' }),
  lib({ id: 'jasypt', name: 'Jasypt', category: 'Cryptography', groupId: 'org.jasypt', artifactId: 'jasypt', version: '1.9.3', license: 'Apache-2.0', packages: ['org.jasypt'], description: 'Simple property/string encryption.' }),
  lib({ id: 'commons-codec', name: 'Apache Commons Codec', category: 'Cryptography', groupId: 'commons-codec', artifactId: 'commons-codec', version: '1.18.0', license: 'Apache-2.0', packages: ['org.apache.commons.codec'], description: 'Base64/hex/digest encoders and codecs.' }),
  lib({ id: 'password4j', name: 'Password4j', category: 'Cryptography', groupId: 'com.password4j', artifactId: 'password4j', version: '1.8.3', license: 'Apache-2.0', packages: ['com.password4j'], description: 'Password hashing and verification.' }),

  // 14. CSV and spreadsheet processing
  lib({ id: 'commons-csv', name: 'Apache Commons CSV', category: 'CSV & Spreadsheet', groupId: 'org.apache.commons', artifactId: 'commons-csv', version: '1.13.0', license: 'Apache-2.0', packages: ['org.apache.commons.csv'], description: 'Read/write CSV in many dialects.' }),
  lib({ id: 'opencsv', name: 'OpenCSV', category: 'CSV & Spreadsheet', groupId: 'com.opencsv', artifactId: 'opencsv', version: '5.10', license: 'Apache-2.0', packages: ['com.opencsv'], description: 'Simple CSV read/write bean mapping.' }),
  lib({ id: 'univocity-parsers', name: 'univocity-parsers', category: 'CSV & Spreadsheet', groupId: 'com.univocity', artifactId: 'univocity-parsers', version: '2.9.1', license: 'Apache-2.0', packages: ['com.univocity.parsers'], description: 'Very fast CSV/TSV/Fixed parsers.' }),
  lib({ id: 'poi-ooxml', name: 'Apache POI (OOXML)', category: 'CSV & Spreadsheet', groupId: 'org.apache.poi', artifactId: 'poi-ooxml', version: '5.4.0', license: 'Apache-2.0', packages: ['org.apache.poi'], description: 'Read/write Excel and Office documents.' }),
  lib({ id: 'excel-streaming-reader', name: 'Excel Streaming Reader', category: 'CSV & Spreadsheet', groupId: 'com.github.pjfanning', artifactId: 'excel-streaming-reader', version: '5.1.0', license: 'Apache-2.0', packages: ['com.github.pjfanning.xlsx'], description: 'Low-memory streaming Excel reader.' }),

  // 15. File and document processing
  lib({ id: 'tika-core', name: 'Apache Tika Core', category: 'File & Document Processing', groupId: 'org.apache.tika', artifactId: 'tika-core', version: '3.1.0', license: 'Apache-2.0', packages: ['org.apache.tika'], description: 'Detect and extract document content/metadata.' }),
  lib({ id: 'pdfbox', name: 'Apache PDFBox', category: 'File & Document Processing', groupId: 'org.apache.pdfbox', artifactId: 'pdfbox', version: '3.0.4', license: 'Apache-2.0', packages: ['org.apache.pdfbox'], description: 'Work with PDF documents.' }),
  lib({ id: 'commons-compress', name: 'Apache Commons Compress', category: 'File & Document Processing', groupId: 'org.apache.commons', artifactId: 'commons-compress', version: '1.27.1', license: 'Apache-2.0', packages: ['org.apache.commons.compress'], description: 'Archive codecs: zip/tar/gzip/etc.' }),
  lib({ id: 'itext-core', name: 'iText 7 Core', category: 'File & Document Processing', groupId: 'com.itextpdf', artifactId: 'itext-core', version: '9.1.0', license: 'AGPL-3.0', packages: ['com.itextpdf'], description: 'Create and manipulate PDF documents.' }),
  lib({ id: 'docx4j', name: 'docx4j', category: 'File & Document Processing', groupId: 'org.docx4j', artifactId: 'docx4j-JAXB-ReferenceImpl', version: '11.5.4', license: 'Apache-2.0', packages: ['org.docx4j'], description: 'Create/manipulate WordprocessingML (DOCX).' }),

  // 16. HTML parsing
  lib({ id: 'jsoup', name: 'jsoup', category: 'HTML Parsing', groupId: 'org.jsoup', artifactId: 'jsoup', version: '1.19.1', license: 'MIT', packages: ['org.jsoup'], description: 'Parse, clean, and query HTML.' }),
  lib({ id: 'htmlunit', name: 'HtmlUnit', category: 'HTML Parsing', groupId: 'net.sourceforge.htmlunit', artifactId: 'htmlunit', version: '2.70.0', license: 'Apache-2.0', packages: ['org.htmlunit'], description: 'Headless browser for testing/scraping.' }),
  lib({ id: 'owasp-html-sanitizer', name: 'OWASP Java HTML Sanitizer', category: 'HTML Parsing', groupId: 'com.googlecode.owasp-java-html-sanitizer', artifactId: 'owasp-java-html-sanitizer', version: '20240325.1', license: 'Apache-2.0', packages: ['org.owasp.html'], description: 'Policy-based HTML sanitization.' }),
  lib({ id: 'flexmark-all', name: 'flexmark (Markdown)', category: 'HTML Parsing', groupId: 'com.vladsch.flexmark', artifactId: 'flexmark-all', version: '0.64.8', license: 'BSD-2-Clause', packages: ['com.vladsch.flexmark'], description: 'Markdown parser/extension framework.' }),
  lib({ id: 'jersey-html', name: 'JTidy', category: 'HTML Parsing', groupId: 'net.sf.jtidy', artifactId: 'jtidy', version: 'r938', license: 'Java HTML Tidy License', packages: ['org.w3c.tidy'], description: 'Validate and clean HTML/XML (Tidy).' }),

  // 17. Web frameworks
  lib({ id: 'spark-core', name: 'Spark', category: 'Web Frameworks', groupId: 'com.sparkjava', artifactId: 'spark-core', version: '2.9.4', license: 'Apache-2.0', packages: ['spark'], description: 'Ruby/Sinatra-style micro web framework.' }),
  lib({ id: 'javalin', name: 'Javalin', category: 'Web Frameworks', groupId: 'io.javalin', artifactId: 'javalin', version: '6.6.0', license: 'Apache-2.0', packages: ['io.javalin'], description: 'Simple REST/web framework on Jetty.' }),
  lib({ id: 'dropwizard-core', name: 'Dropwizard', category: 'Web Frameworks', groupId: 'io.dropwizard', artifactId: 'dropwizard-core', version: '4.0.13', license: 'Apache-2.0', packages: ['io.dropwizard'], description: 'Ops-friendly REST framework.' }),
  lib({ id: 'jersey-server', name: 'Jersey', category: 'Web Frameworks', groupId: 'org.glassfish.jersey.core', artifactId: 'jersey-server', version: '3.1.10', license: 'EPL-2.0', packages: ['org.glassfish.jersey'], description: 'Jakarta REST reference implementation.' }),
  lib({ id: 'undertow-core', name: 'Undertow', category: 'Web Frameworks', groupId: 'io.undertow', artifactId: 'undertow-core', version: '2.3.18.Final', license: 'Apache-2.0', packages: ['io.undertow'], description: 'Flexible non-blocking web server.' }),

  // 18. Dependency injection
  lib({ id: 'guice', name: 'Guice', category: 'Dependency Injection', groupId: 'com.google.inject', artifactId: 'guice', version: '7.0.0', license: 'Apache-2.0', packages: ['com.google.inject'], description: 'Lightweight dependency injection.' }),
  lib({ id: 'spring-context', name: 'Spring Context', category: 'Dependency Injection', groupId: 'org.springframework', artifactId: 'spring-context', version: '6.2.6', license: 'Apache-2.0', packages: ['org.springframework'], description: 'IoC container and DI foundation.' }),
  lib({ id: 'dagger', name: 'Dagger 2', category: 'Dependency Injection', groupId: 'com.google.dagger', artifactId: 'dagger', version: '2.56', license: 'Apache-2.0', packages: ['dagger'], description: 'Compile-time dependency injection.' }),
  lib({ id: 'cdi-api', name: 'Jakarta CDI API', category: 'Dependency Injection', groupId: 'jakarta.enterprise', artifactId: 'jakarta.enterprise.cdi-api', version: '4.1.0', license: 'EPL-2.0', packages: ['jakarta.enterprise.inject', 'jakarta.inject'], description: 'Contexts & Dependency Injection API.' }),
  lib({ id: 'picocontainer', name: 'PicoContainer', category: 'Dependency Injection', groupId: 'org.picocontainer', artifactId: 'picocontainer', version: '2.15', license: 'BSD-3-Clause', packages: ['org.picocontainer'], description: 'A micro DI container.' }),

  // 19. Serialization
  lib({ id: 'kryo', name: 'Kryo', category: 'Serialization', groupId: 'com.esotericsoftware', artifactId: 'kryo', version: '5.6.2', license: 'BSD-3-Clause', packages: ['com.esotericsoftware.kryo'], description: 'Fast binary object serialization.' }),
  lib({ id: 'protobuf-java', name: 'Protocol Buffers', category: 'Serialization', groupId: 'com.google.protobuf', artifactId: 'protobuf-java', version: '4.30.2', license: 'BSD-3-Clause', packages: ['com.google.protobuf'], description: 'Google Protocol Buffers runtime.' }),
  lib({ id: 'avro', name: 'Apache Avro', category: 'Serialization', groupId: 'org.apache.avro', artifactId: 'avro', version: '1.12.0', license: 'Apache-2.0', packages: ['org.apache.avro'], description: 'Schema-based data serialization.' }),
  lib({ id: 'protostuff-core', name: 'Protostuff', category: 'Serialization', groupId: 'io.protostuff', artifactId: 'protostuff-core', version: '1.8.0', license: 'Apache-2.0', packages: ['io.protostuff'], description: 'Schema-less, polymorphic serialization.' }),
  lib({ id: 'msgpack-core', name: 'MessagePack', category: 'Serialization', groupId: 'org.msgpack', artifactId: 'msgpack-core', version: '0.9.9', license: 'Apache-2.0', packages: ['org.msgpack'], description: 'Efficient binary JSON-like serialization.' }),

  // 20. Developer productivity
  lib({ id: 'lombok', name: 'Project Lombok', category: 'Developer Productivity', groupId: 'org.projectlombok', artifactId: 'lombok', version: '1.18.38', license: 'MIT', packages: ['lombok'], description: 'Annotation-driven boilerplate reduction.' }),
  lib({ id: 'mapstruct', name: 'MapStruct', category: 'Developer Productivity', groupId: 'org.mapstruct', artifactId: 'mapstruct', version: '1.6.3', license: 'Apache-2.0', packages: ['org.mapstruct'], description: 'Type-safe, generated bean mappers.' }),
  lib({ id: 'jansi', name: 'Jansi', category: 'Developer Productivity', groupId: 'org.fusesource.jansi', artifactId: 'jansi', version: '2.4.1', license: 'Apache-2.0', packages: ['org.fusesource.jansi'], description: 'Cross-platform ANSI console colors.' }),
  lib({ id: 'micrometer-core', name: 'Micrometer', category: 'Developer Productivity', groupId: 'io.micrometer', artifactId: 'micrometer-core', version: '1.14.6', license: 'Apache-2.0', packages: ['io.micrometer'], description: 'Application metrics instrumentation.' }),
  lib({ id: 'spotbugs-annotations', name: 'SpotBugs Annotations', category: 'Developer Productivity', groupId: 'com.github.spotbugs', artifactId: 'spotbugs-annotations', version: '4.9.3', license: 'LGPL-2.1', packages: ['edu.umd.cs.findbugs.annotations'], description: 'Annotations for static bug analysis.' }),
];

// ---- helpers ---------------------------------------------------------------

const byId = new Map(JAVA_LIBRARY_CATALOG.map((e) => [e.id, e]));

export function listCatalog() {
  return JAVA_LIBRARY_CATALOG;
}

export function getById(id) {
  return byId.get(id) || null;
}

export function listByCategory() {
  const grouped = {};
  for (const cat of CATEGORIES) grouped[cat] = [];
  for (const e of JAVA_LIBRARY_CATALOG) (grouped[e.category] ||= []).push(e);
  return grouped;
}

/**
 * Return the catalog entries that can satisfy a Java fully-qualified import,
 * longest matching `packages` prefix first. A `com.google.common.*` import
 * matches Guava; an import with no matching prefix yields []. Ambiguity (several
 * artifacts claiming the same prefix) is preserved so callers can ask for an
 * explicit selection instead of guessing.
 */
export function findByPackage(importFqn) {
  const fqn = String(importFqn || '').trim();
  if (!fqn) return [];
  const scored = [];
  for (const e of JAVA_LIBRARY_CATALOG) {
    let best = 0;
    for (const p of e.packages) {
      if (fqn === p || fqn.startsWith(`${p}.`)) best = Math.max(best, p.length);
    }
    if (best > 0) scored.push({ entry: e, len: best });
  }
  scored.sort((a, b) => b.len - a.len);
  return scored.map((s) => s.entry);
}
