using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class MemberAddedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "AddedAt",
                table: "ProjectMembers",
                type: ActiveProvider == "Microsoft.EntityFrameworkCore.Sqlite" ? "TEXT" : "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            // When existing members joined is not known, so they get their project's creation date; the owner is
            // ordered first anyway.
            migrationBuilder.Sql(
                "UPDATE \"ProjectMembers\" SET \"AddedAt\" = " +
                "(SELECT \"CreatedAt\" FROM \"Projects\" WHERE \"Projects\".\"Id\" = \"ProjectMembers\".\"ProjectId\");");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AddedAt",
                table: "ProjectMembers");
        }
    }
}
