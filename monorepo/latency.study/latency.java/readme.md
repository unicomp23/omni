# MSK Latency

This is a simple Java console application built with Maven.

## Prerequisites

- Java Development Kit (JDK) 11 or later
- Maven 3.6.0 or later

## Building the Project

To build the project, run the following command in the project root directory:

```
mvn clean package
```

This will compile the source code, run tests (if any), and create a JAR file in the `target` directory.

## Running the Application

After building the project, you can run the application using the following command:

```
mvn exec:java
```

Alternatively, you can use the following command:

```
mvn exec:java -Dexec.mainClass="com.cantina.Main"
```

## Development

To compile the project without creating a JAR:

```
mvn compile
```

To run tests:

```
mvn test
```

## Project Structure

- `src/main/java/` - Contains the application source code
- `src/test/java/` - Contains test code (if any)
- `pom.xml` - Maven project configuration file
- `.gitignore` - Specifies intentionally untracked files to ignore

## License

[Specify your license here]