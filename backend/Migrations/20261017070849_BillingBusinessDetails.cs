using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class BillingBusinessDetails : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BillingContractorAddress",
                table: "Projects",
                type: ActiveProvider == "Microsoft.EntityFrameworkCore.Sqlite" ? "TEXT" : "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "BillingLogo",
                table: "Projects",
                type: ActiveProvider == "Microsoft.EntityFrameworkCore.Sqlite" ? "TEXT" : "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BillingOrgNumber",
                table: "Projects",
                type: ActiveProvider == "Microsoft.EntityFrameworkCore.Sqlite" ? "TEXT" : "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "BillingPaymentDetails",
                table: "Projects",
                type: ActiveProvider == "Microsoft.EntityFrameworkCore.Sqlite" ? "TEXT" : "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "BillingPaymentTermsDays",
                table: "Projects",
                type: ActiveProvider == "Microsoft.EntityFrameworkCore.Sqlite" ? "INTEGER" : "integer",
                nullable: false,
                defaultValue: 14);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BillingContractorAddress",
                table: "Projects");

            migrationBuilder.DropColumn(
                name: "BillingLogo",
                table: "Projects");

            migrationBuilder.DropColumn(
                name: "BillingOrgNumber",
                table: "Projects");

            migrationBuilder.DropColumn(
                name: "BillingPaymentDetails",
                table: "Projects");

            migrationBuilder.DropColumn(
                name: "BillingPaymentTermsDays",
                table: "Projects");
        }
    }
}
