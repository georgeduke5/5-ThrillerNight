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

  it("reports every bad row by its spreadsheet row number", () => {
    const csv =
      "First Name,Last Name,Category,Phone Number\n" + // row 1
      "Ann,Lee,Adult Female,555-111-2222\n" + // row 2: fine
      "Bob,,Adult Male,555-111-2223\n" + // row 3: missing last name
      "Cal,Lee,Man,555-111-2224\n" + // row 4: bad category
      "Dee,Lee,Girl\n" + // row 5: missing phone
      "Eve,Lee,Girl,call me\n" + // row 6: bad phone
      "Fay,Lee,Girl,555-111-2226,extra"; // row 7: too many columns
    const { guests, errors } = parseCsvForImport(csv);

    expect(guests).toHaveLength(1);
    expect(errors.map((e) => e.row)).toEqual([3, 4, 5, 6, 7]);
    expect(errors[0]?.message).toMatch(/missing Last Name/);
    expect(errors[1]?.message).toMatch(/invalid Category "Man".*Adult Male, Adult Female, Boy, Girl/);
    expect(errors[2]?.message).toMatch(/missing Phone Number/);
    expect(errors[3]?.message).toMatch(/invalid Phone Number/);
    expect(errors[4]?.message).toMatch(/expected 4 columns/);
  });

  it("ignores blank lines and trailing empty columns", () => {
    const { guests, errors } = parseCsvForImport("Ann,Lee,Girl,555-111-2222,,\n\n   \n");
    expect(errors).toEqual([]);
    expect(guests).toHaveLength(1);
  });
});
