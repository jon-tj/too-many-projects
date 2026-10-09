using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class Signup : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            var sqlite = ActiveProvider == "Microsoft.EntityFrameworkCore.Sqlite";

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "CreatedAt",
                table: "AspNetUsers",
                type: sqlite ? "TEXT" : "timestamp with time zone",
                nullable: false,
                // Existing accounts get the day sign-up was added; when they were really created is not known.
                defaultValue: new DateTimeOffset(2026, 10, 9, 0, 0, 0, TimeSpan.Zero));

            migrationBuilder.AddColumn<string>(
                name: "PrimaryUseCase",
                table: "AspNetUsers",
                type: sqlite ? "TEXT" : "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "SignupReferrer",
                table: "AspNetUsers",
                type: sqlite ? "TEXT" : "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TeamRole",
                table: "AspNetUsers",
                type: sqlite ? "TEXT" : "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "TrialEndsAt",
                table: "AspNetUsers",
                type: sqlite ? "TEXT" : "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "UtmCampaign",
                table: "AspNetUsers",
                type: sqlite ? "TEXT" : "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "UtmContent",
                table: "AspNetUsers",
                type: sqlite ? "TEXT" : "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "UtmMedium",
                table: "AspNetUsers",
                type: sqlite ? "TEXT" : "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "UtmSource",
                table: "AspNetUsers",
                type: sqlite ? "TEXT" : "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "UtmTerm",
                table: "AspNetUsers",
                type: sqlite ? "TEXT" : "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CreatedAt",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "PrimaryUseCase",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "SignupReferrer",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "TeamRole",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "TrialEndsAt",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "UtmCampaign",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "UtmContent",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "UtmMedium",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "UtmSource",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "UtmTerm",
                table: "AspNetUsers");
        }
    }
}
