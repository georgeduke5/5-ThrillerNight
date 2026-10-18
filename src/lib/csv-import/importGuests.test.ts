import { describe, expect, it } from "vitest";
import { parseCsvForImport } from "./importGuests";

describe("parseCsvForImport", () => {
  it("maps each Category straight to its bracket, with or without a header row", () => {
    const rows =
      "Ann,Lee,Adult Female,555-111-2222\n" +
      "Bob,Lee,Adult Male,(555) 111-2223\n" +
      "Cal,Lee,Boy,+1 555 111 2224\n" +
      "Dee,Lee,Girl,555.111.2225";
    const withHeader = parseCsvForImport("First Name,Last Name,Category,Phone Number\n" + rows);
    const withoutHeader = parseCsvForImport(rows);

    for (const result of [withHeader, withoutHeader]) {
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.guests.map((g) => g.bracket)).toEqual(["adult-female", "adult-male", "boy", "girl"]);
    }
    expect(withHeader.guests[0]).toEqual({
      firstName: "Ann",
      lastName: "Lee",
      bracket: "adult-female",
      phone: "555-111-2222",
    });
  });

  it("accepts Category case-insensitively and trims whitespace", () => {
    const { guests, errors } = parseCsvForImport("  Ann , Lee ,  adult   FEMALE , 555-111-2222 ");
    expect(errors).toEqual([]);
    expect(guests[0]).toEqual({ firstName: "Ann", lastName: "Lee", bracket: "adult-female", phone: "555-111-2222" });
  });

  it("blocks only rows with a bad Category, no name at all, or too many columns, by spreadsheet row number", () => {
    const csv =
      "First Name,Last Name,Category,Phone Number\n" + // row 1
      "Ann,Lee,Adult Female,555-111-2222\n" + // row 2: fine
      "Cal,Lee,Man,555-111-2224\n" + // row 3: bad category
      "Dee,Lee,,555-111-2225\n" + // row 4: missing category
      ",,Girl,555-111-2226\n" + // row 5: no name at all
      "Fay,Lee,Girl,555-111-2226,extra"; // row 6: too many columns
    const { guests, errors } = parseCsvForImport(csv);

    expect(guests).toHaveLength(1);
    expect(errors.map((e) => e.row)).toEqual([3, 4, 5, 6]);
    expect(errors[0]?.message).toMatch(/invalid Category "Man".*Adult Male, Adult Female, Boy, Girl/);
    expect(errors[1]?.message).toMatch(/missing Category/);
    expect(errors[2]?.message).toMatch(/missing First Name and Last Name/);
    expect(errors[3]?.message).toMatch(/expected 4 columns/);
  });

  it("imports a row missing a first or last name, with a warning naming the row", () => {
    const csv =
      "First Name,Last Name,Category,Phone Number\n" +
      "Bob,,Adult Male,555-111-2223\n" + // row 2
      ",Lee,Girl,555-111-2224"; // row 3
    const { guests, errors, warnings } = parseCsvForImport(csv);

    expect(errors).toEqual([]);
    expect(guests.map((g) => [g.firstName, g.lastName])).toEqual([
      ["Bob", ""],
      ["", "Lee"],
    ]);
    expect(warnings).toEqual([
      { row: 2, message: "missing Last Name" },
      { row: 3, message: "missing First Name" },
    ]);
  });

  it("imports blank, placeholder and malformed phones with no phone stored, and warns for each row", () => {
    const csv =
      "First Name,Last Name,Category,Phone Number\n" +
      "Ann,Lee,Girl\n" + // row 2: no phone column at all
      "Bob,Lee,Boy,\n" + // row 3: blank
      "Cal,Lee,Boy,no phone\n" + // row 4
      "Dee,Lee,Girl,N/A\n" + // row 5
      "Eve,Lee,Girl,none\n" + // row 6
      "Fay,Lee,Girl,555-0123\n" + // row 7: too few digits
      "Gus,Lee,Boy,=HYPERLINK(1)\n" + // row 8: garbage
      "Hal,Lee,Boy,+1 (555) 111-2229"; // row 9: fine
    const { guests, errors, warnings } = parseCsvForImport(csv);

    expect(errors).toEqual([]);
    expect(guests.map((g) => g.phone)).toEqual([null, null, null, null, null, null, null, "+1 (555) 111-2229"]);
    expect(warnings.map((w) => w.row)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    for (const w of warnings.slice(0, 5)) expect(w.message).toBe("no phone on file");
    expect(warnings[5]?.message).toMatch(/"555-0123" isn't a valid 10-digit number.*no phone on file/);
    expect(warnings[6]?.message).toMatch(/"=HYPERLINK\(1\)" isn't a valid 10-digit number/);
  });

  it("puts a row's name and phone warnings on one line", () => {
    const { warnings } = parseCsvForImport("Ann,,Girl,n/a");
    expect(warnings).toEqual([{ row: 1, message: "missing Last Name; no phone on file" }]);
  });

  it("ignores blank lines and trailing empty columns", () => {
    const { guests, errors } = parseCsvForImport("Ann,Lee,Girl,555-111-2222,,\n\n   \n");
    expect(errors).toEqual([]);
    expect(guests).toHaveLength(1);
  });
});
