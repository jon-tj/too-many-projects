using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <summary>
    /// "Point of contact" became "contractor": renames the project column, and the copy of it inside every finalized
    /// bill's saved report, so old bills keep showing it.
    /// </summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261016080000_BillingContractorName")]
    public partial class BillingContractorName : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "BillingContactName",
                table: "Projects",
                newName: "BillingContractorName");

            migrationBuilder.Sql(
                "UPDATE \"Bills\" SET \"ReportJson\" = REPLACE(\"ReportJson\", '\"contactName\":', '\"contractorName\":')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "UPDATE \"Bills\" SET \"ReportJson\" = REPLACE(\"ReportJson\", '\"contractorName\":', '\"contactName\":')");

            migrationBuilder.RenameColumn(
                name: "BillingContractorName",
                table: "Projects",
                newName: "BillingContactName");
        }
    }
}
