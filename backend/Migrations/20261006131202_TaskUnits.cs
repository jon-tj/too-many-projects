using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class TaskUnits : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Units",
                table: "ProjectTasks",
                type: ActiveProvider == "Microsoft.EntityFrameworkCore.Sqlite" ? "INTEGER" : "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "UnitsDone",
                table: "ProjectTasks",
                type: ActiveProvider == "Microsoft.EntityFrameworkCore.Sqlite" ? "INTEGER" : "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Units",
                table: "ProjectTasks");

            migrationBuilder.DropColumn(
                name: "UnitsDone",
                table: "ProjectTasks");
        }
    }
}
